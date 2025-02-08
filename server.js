const express = require("express");
const sharp = require("sharp");
const bodyParser = require("body-parser");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST"], // Allowed methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
  })
);

app.use(bodyParser.json({ limit: "10mb" })); // Increase payload limit for large images

// Add Google Drive authentication configuration
const KEYFILEPATH = path.join(__dirname, "keys.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const folderId =
  process.env.GOOGLE_DRIVE_FOLDER_ID || "1mD8gu8bm420siEPI9enGKqKfyP5Svi2h";

// Read credentials directly from the file
let credentials;
try {
  credentials = JSON.parse(fs.readFileSync(KEYFILEPATH, "utf8"));
} catch (error) {
  console.error("Error reading credentials file:", error);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: credentials, // Pass the parsed credentials directly
  scopes: SCOPES,
});

// Create Google Drive client
const driveClient = google.drive({ version: "v3", auth });

// API route to add border to base64 image
app.post("/add-border", async (req, res) => {
  try {
    // Validate request
    const { image_base64, border_size, border_color } = req.body;

    if (!image_base64 || typeof image_base64 !== "string") {
      return res
        .status(400)
        .json({ error: "Invalid or missing image_base64." });
    }
    if (border_size === undefined || border_size < 0 || border_size > 50) {
      return res
        .status(400)
        .json({ error: "border_size must be between 0 and 50." });
    }

    const borderColor = border_color || "#000000"; // Default to black
    const borderRGBA = hexToRGBA(borderColor); // Convert hex to RGBA

    // Remove metadata from base64
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Get original image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const newWidth = metadata.width + border_size * 2;
    const newHeight = metadata.height + border_size * 2;

    // Create a new image with a border
    const borderedImageBuffer = await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 4, // RGBA
        background: borderRGBA,
      },
    })
      .composite([{ input: imageBuffer, top: border_size, left: border_size }])
      .jpeg({
        quality: 100, // Maximum JPEG quality
        mozjpeg: true, // Use mozjpeg for better compression while maintaining quality
      })
      .toBuffer();

    // Upload to Google Drive
    const fileMetadata = {
      name: `bordered_image_${Date.now()}.jpg`,
      parents: [folderId],
    };

    const media = {
      mimeType: "image/jpeg",
      body: require("stream").Readable.from([borderedImageBuffer]),
    };

    const file = await driveClient.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    res.json({
      status: "success",
      border_size,
      fileId: file.data.id,
      viewLink: file.data.webViewLink,
    });
  } catch (error) {
    console.error("Error processing image:", error);
    res
      .status(500)
      .json({ error: "Failed to process image.", reason: error.message });
  }
});


// Convert hex to RGBA (Sharp requires an array format)
function hexToRGBA(hex) {
  hex = hex.replace("#", "");
  const bigint = parseInt(hex, 16);
  return [
    (bigint >> 16) & 255, // Red
    (bigint >> 8) & 255, // Green
    bigint & 255, // Blue
    255, // Alpha (fully opaque)
  ];
}

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
