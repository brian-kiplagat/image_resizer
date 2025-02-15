const express = require("express");
const sharp = require("sharp");
const bodyParser = require("body-parser");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
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
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];
const folderId =
  process.env.GOOGLE_DRIVE_FOLDER_ID || "1mD8gu8bm420siEPI9enGKqKfyP5Svi2h";
const confirmedFolderId =
  process.env.GOOGLE_DRIVE_CONFIRMED_FOLDER_ID ||
  "1t7kUVD3Y3LK3ofNYJDL9zTKxfigUdsvA";

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
const sheets = google.sheets({ version: "v4", auth });

// Add paper size dimensions (in pixels at 300 DPI)
const PAPER_SIZES = {
  A0: { width: 9933, height: 14043 },
  A1: { width: 7016, height: 9933 },
  A2: { width: 4961, height: 7016 },
  A3: { width: 3508, height: 4961 },
  A4: { width: 2480, height: 3508 },
  A5: { width: 1748, height: 2480 },
  A6: { width: 1240, height: 1748 },
  // B series (in pixels at 300 DPI)
  B0: { width: 11811, height: 16717 },
  B1: { width: 8358, height: 11811 },
  B2: { width: 5906, height: 8358 },
  B3: { width: 4179, height: 5906 },
  B4: { width: 2953, height: 4179 },
  B5: { width: 2079, height: 2953 },
  B6: { width: 1476, height: 2079 },
};

// Add this near your other environment variables
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1xEVqnwi6351iN3zutJ_V_xuRU6FVBkOGjAwbU3iKics"; // You'll need to add this to your .env file

// API route to add border to base64 image
app.post("/add-border", async (req, res) => {
  try {
    // Validate request with detailed error messages
    const {
      originalbase64Image,
      border_size,
      border_color,
      orientation,
      orderID,
      paperSize,
      resizeOption,
      isCustom,
      sizes,
    } = req.body;

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
    //check if isCustom is true, then sizes must be present and valid
    if (isCustom) {
      //check if sizes is proper format
      if (
        !sizes.width ||
        !sizes.height ||
        typeof sizes.width !== "number" ||
        typeof sizes.height !== "number"
      ) {
        return res.status(400).json({ error: "Invalid or missing sizes" });
      }
    }

    if (!originalbase64Image || typeof originalbase64Image !== "string") {
      return res
        .status(400)
        .json({ error: "Invalid or missing originalbase64Image" });
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

    // Get paper dimensions based on orientation and custom sizes
    let paperDims;
    if (isCustom && sizes) {
      paperDims = {
        width: sizes.width,
        height: sizes.height,
      };
    } else {
      paperDims = PAPER_SIZES[paperSize];
      if (!paperDims) {
        return res.status(400).json({
          error: "Invalid paper size. Must be between A0-A6 or B0-B6",
        });
      }
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
      name: `${orderID}_Modified.jpg`,
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
      name: `${orderID}_Original.jpg`,
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

// Extract paper details from meta_data
const getPaperDetails = (metaData) => {
  return {
    paperSize: metaData.find((m) => m.key === "paper_size")?.value || "",
    paperType: metaData.find((m) => m.key === "paper_type")?.value || "",
    borderSize: metaData.find((m) => m.key === "border_size")?.value || "",
    orientation: metaData.find((m) => m.key === "orientation")?.value || "",
  };
};

// Get image link from line items
const getImageLink = (lineItems) => {
  return lineItems[0]?.image?.src || "";
};

// Format shipping address
const formatShippingAddress = (shipping) => {
  const parts = [
    shipping.first_name,
    shipping.last_name,
    shipping.address_1,
    shipping.address_2,
    shipping.city,
    shipping.state,
    shipping.postcode,
    shipping.country,
  ].filter(Boolean); // Remove empty values

  return parts.join(", ");
};

// Format customer name
const formatCustomerName = (shipping, billing) => {
  // Try shipping name first, then billing name
  const firstName = shipping.first_name || billing.first_name || "";
  const lastName = shipping.last_name || billing.last_name || "";
  return [firstName, lastName].filter(Boolean).join(" ") || "Guest";
};

// Get filenames for modified and original images
const getImageFilenames = (orderId) => {
  return {
    modified: `${orderId}_Modified.jpg`,
    original: `${orderId}_Original.jpg`,
  };
};

app.post("/confirm-order", async (req, res) => {
  try {
    const { id } = req.body;

    // Validate order ID
    if (!id || typeof id !== "number") {
      return res.status(400).json({ error: "Invalid or missing order ID" });
    }

    // Fetch order details from WooCommerce
    const orderResponse = await axios.get(`${WOO_BASE_URL}/${id}`, {
      auth: { username: WOO_CONSUMER_KEY, password: WOO_CONSUMER_SECRET },
    });

    const order = orderResponse.data;
    const paperDetails = getPaperDetails(order.meta_data);
    const imageFiles = getImageFilenames(order.number);
    const customerName = formatCustomerName(order.shipping, order.billing);
    const shippingAddress = formatShippingAddress(order.shipping);

    // Check if payment was successful
    if (order.status === "processing" || order.status === "completed") {
      try {
        // List files in the original folder to find the order's files
        const response = await driveClient.files.list({
          q: `'${folderId}' in parents and name contains '${id}'`,
          fields: "files(id, name)",
        });

        const files = response.data.files;

        // Move each file to the confirmed folder
        for (const file of files) {
          // Update the file's parent folder
          await driveClient.files.update({
            fileId: file.id,
            addParents: confirmedFolderId,
            removeParents: folderId,
            fields: "id, parents",
          });

          console.log(`Moved file ${file.name} to confirmed folder`);
        }

        // Log to Google Sheets with correct column order
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Sheet1!A:J",
          valueInputOption: "USER_ENTERED",
          resource: {
            values: [
              [
                order.date_created, // Order date
                order.number, // Order number
                order.status, // Status
                paperDetails.paperType, // Paper type
                paperDetails.paperSize, // Paper size
                paperDetails.borderSize, // Border size
                paperDetails.orientation, // Orientation
                imageFiles.modified, // Link to print image (modified filename)
                customerName, // Customer name
                shippingAddress, // Shipping address
              ],
            ],
          },
        });

        console.log(
          `Order ${order.number} logged to spreadsheet in specified order`
        );

        return res.status(200).json({
          message: "Order is confirmed and files moved!",
          order,
          movedFiles: files.map((f) => f.name),
        });
      } catch (error) {
        console.error("Error moving files:", error);
        return res.status(500).json({
          error: "Failed to move files to confirmed folder",
          reason: error.message,
        });
      }
    } else {
      return res.status(400).json({
        error: "Payment not completed or order not confirmed.",
        status: order.status,
      });
    }
  } catch (error) {
    console.error("Error confirming order:", error);
    res.status(500).json({
      error: "Failed to confirm order.",
      reason: error.message,
    });
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
