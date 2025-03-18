const express = require("express");
const sharp = require("sharp");
const bodyParser = require("body-parser");
const cors = require("cors");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
require("dotenv").config();
const heicConvert = require("heic-convert");

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

// Add paper size dimensions (in pixels at 600 DPI)
const PAPER_SIZES = {
  // A series (in pixels at 600 DPI)
  A0: { width: 19866, height: 28086 },
  A1: { width: 14032, height: 19866 },
  A2: { width: 9922, height: 14032 },
  A3: { width: 7016, height: 9922 },
  A4: { width: 4960, height: 7016 },
  A5: { width: 3496, height: 4960 },
  A6: { width: 2480, height: 3496 },
  // B series (in pixels at 600 DPI)
  B0: { width: 23622, height: 33434 },
  B1: { width: 16716, height: 23622 },
  B2: { width: 11812, height: 16716 },
  B3: { width: 8358, height: 11812 },
  B4: { width: 5906, height: 8358 },
  B5: { width: 4158, height: 5906 },
  B6: { width: 2952, height: 4158 },
};

// Add this near your other environment variables
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1xEVqnwi6351iN3zutJ_V_xuRU6FVBkOGjAwbU3iKics"; // You'll need to add this to your .env file

// Add the PDF conversion function
async function convertPdfBase64ToImageBase64(pdfBase64) {
  try {
    // Dynamically import pdf-to-img
    const { pdf } = await import("pdf-to-img");

    // Validate and extract base64 data
    if (!pdfBase64.includes(";base64,")) {
      throw new Error("Invalid PDF base64 string");
    }

    const base64Data = pdfBase64.split(";base64,")[1];
    if (!base64Data) {
      throw new Error("Invalid PDF base64 string");
    }

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(base64Data, "base64");
    // Convert PDF buffer to document
    const document = await pdf(pdfBuffer, {
      scale: 3, // This will help achieve high DPI
    });

    // Get first page as buffer
    const imageBuffer = await document.getPage(1);
    if (!imageBuffer) {
      throw new Error("Failed to convert PDF page to image");
    }

    // Convert to base64
    const imageBase64 = imageBuffer.toString("base64");
    return `data:image/png;base64,${imageBase64}`; // Changed to PNG since pdf-to-img outputs PNG
  } catch (error) {
    console.error("Error converting PDF to image:", error);
    return null;
  }
}

// Helper function to determine file type and mime type from base64 string
const getFileInfo = (base64String) => {
  const matches =
    base64String.match(/^data:([^;]+);base64,/) ||
    base64String.match(/^@file\/([^;]+);base64,/);

  if (!matches) return { fileType: "jpg", mimeType: "image/jpeg" }; // default

  const mimeType = matches[1].toLowerCase();
  let fileType;

  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      fileType = "jpg";
      break;
    case "image/png":
      fileType = "png";
      break;
    case "image/webp":
      fileType = "webp";
      break;
    case "image/gif":
      fileType = "gif";
      break;
    case "image/avif":
      fileType = "avif";
      break;
    case "image/tiff":
      fileType = "tiff";
      break;
    case "image/svg+xml":
      fileType = "svg";
      break;
    case "application/pdf":
      fileType = "pdf";
      break;
    case "image/heic":
      fileType = "heic";
      break;
    case "application/octet-stream":
      fileType = "heic";
      break;
    default:
      fileType = "jpg";
  }

  return { fileType, mimeType };
};

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
    //check if paperSize is present and valid -- only check when iscustom is false
    if (!isCustom) {
      if (!paperSize || typeof paperSize !== "string") {
        return res.status(400).json({ error: "Invalid or missing paperSize" });
      }
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
    if (border_size === undefined || border_size === null) {
      return res
        .status(400)
        .json({ error: "border_size is required and must be a number" });
    }
    if (border_size < 0 || border_size > 100) {
      return res
        .status(400)
        .json({ error: "border_size must be between 0 and 100" });
    }

    let base64Image = originalbase64Image;

    // If the input is a PDF, convert it to an image
    if (originalbase64Image.toLowerCase().includes("pdf;base64,")) {
      const convertedImage = await convertPdfBase64ToImageBase64(
        originalbase64Image
      );
      if (!convertedImage) {
        return res
          .status(500)
          .json({ error: "Failed to convert PDF to image" });
      }
      base64Image = convertedImage;
    }
    // If the input is a HEIC image, convert it to JPEG/PNG
    else if (
      originalbase64Image.toLowerCase().includes("heic;base64,") ||
      originalbase64Image.toLowerCase().includes("octet-stream;base64")
    ) {
      try {
        const heicBuffer = Buffer.from(
          originalbase64Image.split(";base64,")[1],
          "base64"
        );

        // Convert HEIC to JPEG with high quality
        const convertedBuffer = await heicConvert({
          buffer: heicBuffer,
          format: "JPEG", // or 'PNG'
          quality: 1, // Maximum quality
        });

        base64Image = `data:image/jpeg;base64,${convertedBuffer.toString(
          "base64"
        )}`;
      } catch (error) {
        console.error("HEIC conversion error:", error);
        return res.status(500).json({
          error: "Failed to convert HEIC to image",
          details: error.message,
        });
      }
    }

    // Use the converted image or original image
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
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
        return res
          .status(400)
          .json({ error: "Invalid paper size. Must be between A0 and A6" });
      }
    }

    // Set dimensions based on orientation
    const targetWidth =
      orientation === "Landscape" ? paperDims.height : paperDims.width;
    const targetHeight =
      orientation === "Landscape" ? paperDims.width : paperDims.height;

    // First resize the image according to paper size and resize option
    let resizedImage = sharp(imageBuffer);

    // Convert border size from mm to pixels at 600 DPI
    // 1mm = 23.622047244094 pixels at 600 DPI
    const borderSizeInPixels = Math.round(border_size * 23.622047244094);

    switch (resizeOption) {
      case "cover":
        // For cover, we need to account for the border in the target dimensions
        resizedImage = resizedImage.resize(
          targetWidth - borderSizeInPixels * 2,
          targetHeight - borderSizeInPixels * 2,
          {
            fit: "cover",
          }
        );
        break;
      case "contain":
        resizedImage = resizedImage.resize(
          targetWidth - borderSizeInPixels * 2,
          targetHeight - borderSizeInPixels * 2,
          {
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          }
        );
        break;
      case "fill":
        resizedImage = resizedImage.resize(
          targetWidth - borderSizeInPixels * 2,
          targetHeight - borderSizeInPixels * 2,
          {
            fit: "fill",
            withoutEnlargement: false,
          }
        );
        break;
      case "inside":
        resizedImage = resizedImage.resize(
          targetWidth - borderSizeInPixels * 2,
          targetHeight - borderSizeInPixels * 2,
          {
            fit: "inside",
          }
        );
        break;
      case "outside":
        resizedImage = resizedImage.resize(
          targetWidth - borderSizeInPixels * 2,
          targetHeight - borderSizeInPixels * 2,
          {
            fit: "outside",
          }
        );
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

      // Final dimensions should match the target paper size exactly
      const newWidth = targetWidth;
      const newHeight = targetHeight;

      processedImageBuffer = await sharp({
        create: {
          width: newWidth,
          height: newHeight,
          channels: 4,
          background: borderRGBA,
        },
      })
        .composite([
          {
            input: resizedBuffer,
            top: borderSizeInPixels,
            left: borderSizeInPixels,
          },
        ])
        .jpeg({
          quality: 100,
          chromaSubsampling: "4:4:4",
          force: true,
        })
        .toBuffer();
    }

    // Upload to Google Drive
    const { fileType, mimeType } = getFileInfo(originalbase64Image);

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

    // Upload original image/PDF without any processing
    let originalBuffer;
    if (fileType === "pdf") {
      // Special handling for PDF files
      const pdfBase64Data = originalbase64Image
        .split(";base64,")[1] // Simpler split to get base64 data
        .replace(/\s/g, ""); // Remove any whitespace

      originalBuffer = Buffer.from(pdfBase64Data, "base64");

      // Validate PDF header
      const pdfHeader = originalBuffer.slice(0, 4).toString();
      console.log("PDF header:", pdfHeader);

      if (!pdfHeader.startsWith("%PDF")) {
        console.error("Invalid PDF header:", originalBuffer.slice(0, 8));
        return res.status(400).json({
          error: "Invalid PDF format. File does not appear to be a valid PDF.",
        });
      }
    } else {
      // Handle images as before
      const originalBase64Data = originalbase64Image.replace(
        /^(?:data:|@file\/)[^;]+;base64,/,
        ""
      );
      originalBuffer = Buffer.from(originalBase64Data, "base64");
    }

    const originalFileMetadata = {
      name: `${orderID}_Original.${fileType}`,
      parents: [folderId],
    };

    const originalMedia = {
      mimeType: mimeType,
      body: require("stream").Readable.from([originalBuffer]),
    };

    // Log for debugging
    console.log("Original file type:", fileType);
    console.log("Original MIME type:", mimeType);

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

// Get filenames for modified and original images
const getImageFilenames = (orderId) => {
  return {
    modified: `${orderId}_Modified.jpg`,
    original: `${orderId}_Original.jpg`,
  };
};
//get customer details from meta_data
const getCustomerDetails = (metaData, shipping, billing) => {
  const name = `${shipping.first_name} ${shipping.last_name}` || "";

  // Construct address details string from shipping object
  const addressDetails = `${shipping.first_name} ${shipping.last_name}, ${
    shipping.email || ""
  }, ${shipping.phone}, ${shipping.address_1}, ${shipping.address_2}, ${
    shipping.city
  }, ${shipping.state}, ${shipping.postcode}, ${shipping.country}`;

  // Extract email from shipping object or fallback to second parameter in address string
  const email = billing.email || "";

  console.log("Found customer details:", { name, addressDetails, email });
  return { name, addressDetails, email };
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
    const customerDetails = getCustomerDetails(
      order.meta_data,
      order.shipping,
      order.billing
    );

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
                customerDetails.name, // Customer name
                customerDetails.addressDetails, // Shipping address
              ],
            ],
          },
        });

        console.log(
          `Order ${order.number} logged to spreadsheet in specified order`
        );
        //send email to customer using fetch post request
        const emailResponse = await fetch(
          `https://x8hg-jggq-sea9.n7d.xano.io/api:TVdjrlY-/print/emails`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: customerDetails.email,
              name: customerDetails.name,
              details: `Order ID: ${order.number}\nOrder Date: ${order.date_created}\nOrder Status: ${order.status}\nPaper Type: ${paperDetails.paperType}\nPaper Size: ${paperDetails.paperSize}\nBorder Size: ${paperDetails.borderSize}\nOrientation: ${paperDetails.orientation}`,
            }),
          }
        );
        if (!emailResponse.ok) {
          console.error("Failed to send email:", emailResponse);
        }
        return res.status(200).json({
          message: "Order is confirmed and files moved!",
          movedFiles: files.map((f) => f.name),
          order,
        });
      } catch (error) {
        console.error("Error moving files:", error);
        return res.status(200).json({
          error: "Failed to move files to confirmed folder",
          reason: error.message,
        });
      }
    } else {
      return res.status(200).json({
        error: "Payment not completed or order not confirmed.",
        status: order.status,
      });
    }
  } catch (error) {
    console.error("Error confirming order:", error);
    res.status(200).json({
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
