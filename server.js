const express = require("express");
const sharp = require("sharp");
const bodyParser = require("body-parser");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

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

// Add paper size dimensions (in pixels at 300 DPI)
const PAPER_SIZES = {
  A0: { width: 9933, height: 14043 },
  A1: { width: 7016, height: 9933 },
  A2: { width: 4961, height: 7016 },
  A3: { width: 3508, height: 4961 },
  A4: { width: 2480, height: 3508 },
  A5: { width: 1748, height: 2480 },
  A6: { width: 1240, height: 1748 },
};

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
      paperSize,
      resizeOption,
    } = req.body;

    // Check if required fields are present and valid
    if (!image_base64 || typeof image_base64 !== "string") {
      return res.status(400).json({ error: "Invalid or missing image_base64" });
    }
    //check if orderID is present and valid
    if (!orderID || typeof orderID !== "string") {
      return res.status(400).json({ error: "Invalid or missing orderID" });
    }
    //check if paperSize is present and valid
    if (!paperSize || typeof paperSize !== "string") {
      return res.status(400).json({ error: "Invalid or missing paperSize" });
    }
    //check if resizeOption is present and valid
    if (!resizeOption || typeof resizeOption !== "string") {
      return res.status(400).json({ error: "Invalid or missing resizeOption" });
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

    // Get paper dimensions based on orientation
    const paperDims = PAPER_SIZES[paperSize];
    if (!paperDims) {
      return res
        .status(400)
        .json({ error: "Invalid paper size. Must be between A0 and A6" });
    }

    // Set dimensions based on orientation
    const targetWidth =
      orientation === "Landscape" ? paperDims.height : paperDims.width;
    const targetHeight =
      orientation === "Landscape" ? paperDims.width : paperDims.height;

    // First resize the image according to paper size and resize option
    let resizedImage = sharp(imageBuffer);

    switch (resizeOption) {
      case "cover":
        resizedImage = resizedImage.resize(targetWidth, targetHeight, {
          fit: "cover",
        });
        break;
      case "contain":
        resizedImage = resizedImage.resize(targetWidth, targetHeight, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        });
        break;
      case "fill":
        resizedImage = resizedImage.resize(targetWidth, targetHeight, {
          fit: "fill",
        });
        break;
      case "inside":
        resizedImage = resizedImage.resize(targetWidth, targetHeight, {
          fit: "inside",
        });
        break;
      case "outside":
        resizedImage = resizedImage.resize(targetWidth, targetHeight, {
          fit: "outside",
        });
        break;
      default:
        return res.status(400).json({ error: "Invalid resize option" });
    }

    // Get the resized buffer
    const resizedBuffer = await resizedImage.toBuffer();

    // Skip border processing if border_size is 0 or border_color is falsy
    if (border_size === 0 || !border_color) {
      processedImageBuffer = resizedBuffer;
    } else {
      const borderRGBA = hexToRGBA(border_color);
      const metadata = await sharp(resizedBuffer).metadata();
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
          { input: resizedBuffer, top: border_size, left: border_size },
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
const WOO_BASE_URL = process.env.WOO_BASE_URL; 
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY; 
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET;

app.post("/confirm-order", async (req, res) => {
  try {
    const { id } = req.body;

    // Validate order ID
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Invalid or missing order ID" });
    }

    // Fetch order details from WooCommerce
    const orderResponse = await axios.get(`${WOO_BASE_URL}/${id}`, {
      auth: { username: WOO_CONSUMER_KEY, password: WOO_CONSUMER_SECRET },
    });

    const order = orderResponse.data;

    // Check if payment was successful
    if (order.status === "processing" || order.status === "completed") {
      return res.status(200).json({ message: "Order is confirmed!", order });
    } else {
      return res
        .status(400)
        .json({
          error: "Payment not completed or order not confirmed.",
          status: order.status,
        });
    }
  } catch (error) {
    console.error("Error confirming order:", error);
    res
      .status(500)
      .json({ error: "Failed to confirm order.", reason: error.message });
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
