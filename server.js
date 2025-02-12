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
    // Validate request with detailed error messages
    const {
      image_base64,
      originalbase64Image,
      border_size,
      border_color,
      orientation,
      orderID,
    } = req.body;

    // Check if required fields are present and valid
    if (!image_base64 || typeof image_base64 !== "string") {
      return res.status(400).json({ error: "Invalid or missing image_base64" });
    }
    //check if orderID is present and valid
    if (!orderID || typeof orderID !== "string") {
      return res.status(400).json({ error: "Invalid or missing orderID" });
    }

    if (!originalbase64Image || typeof originalbase64Image !== "string") {
      return res
        .status(400)
        .json({ error: "Invalid or missing originalbase64Image" });
    }
    //ensure image is rquired types eg png, jpg, jpeg, etc
    if (!image_base64.startsWith("data:image/")) {
      return res
        .status(400)
        .json({ error: "Invalid image format. Must start with 'data:image/'" });
    }

    if (!orientation || !["Portrait", "Landscape"].includes(orientation)) {
      return res.status(400).json({
        error:
          "Invalid or missing orientation. Must be 'Portrait' or 'Landscape'",
      });
    }

    // Validate border_size
    if (border_size === undefined || typeof border_size !== "number") {
      return res
        .status(400)
        .json({ error: "border_size is required and must be a number" });
    }
    if (border_size < 0 || border_size > 100) {
      return res
        .status(400)
        .json({ error: "border_size must be between 0 and 100" });
    }

    const base64Data = originalbase64Image.replace(
      /^data:image\/\w+;base64,/,
      ""
    );
    const imageBuffer = Buffer.from(base64Data, "base64");

    let processedImageBuffer;

    // Skip border processing if border_size is 0 or border_color is falsy
    if (border_size === 0 || !border_color) {
      // Just pass through the original image without any processing
      processedImageBuffer = imageBuffer;
    } else {
      const borderRGBA = hexToRGBA(border_color);
      const metadata = await sharp(imageBuffer).metadata();
      const newWidth = metadata.width + border_size * 2;
      const newHeight = metadata.height + border_size * 2;

      processedImageBuffer = await sharp({
        create: {
          width: newWidth,
          height: newHeight,
          channels: 4,
          background: borderRGBA,
        },
      })
        .composite([
          { input: imageBuffer, top: border_size, left: border_size },
        ])
        .jpeg({
          quality: 100,
          chromaSubsampling: "4:4:4",
          force: true,
        })
        .toBuffer();
    }

    // Upload to Google Drive
    const fileMetadata = {
      name: `${orderID}_Modified_${Date.now()}.jpg`,
      parents: [folderId],
    };

    const media = {
      mimeType: "image/jpeg",
      body: require("stream").Readable.from([processedImageBuffer]),
    };

    // Upload processed image
    const file = await driveClient.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    // Upload original image without any processing
    const originalBase64Data = originalbase64Image.replace(
      /^data:image\/\w+;base64,/,
      ""
    );
    const originalImageBuffer = Buffer.from(originalBase64Data, "base64");

    const originalFileMetadata = {
      name: `image_${orderID}_Original.jpg`,
      parents: [folderId],
    };

    const originalMedia = {
      mimeType: "image/jpeg",
      body: require("stream").Readable.from([originalImageBuffer]), // Convert buffer to readable stream
    };

    const originalFile = await driveClient.files.create({
      requestBody: originalFileMetadata,
      media: originalMedia,
      fields: "id, webViewLink",
    });

    res.json({
      status: "success",
      border_size,
      fileId: file.data.id,
      viewLink: file.data.webViewLink,
      originalFileId: originalFile.data.id,
      originalViewLink: originalFile.data.webViewLink,
    });
  } catch (error) {
    console.error("Error processing image:", error);
    res.status(500).json({ error: "Failed to process image.", reason: error });
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
