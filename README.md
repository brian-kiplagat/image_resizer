# Node.js Image Processing and Order Management API

This is a Node.js application designed to handle image manipulation, Google Drive file management, and WooCommerce order processing. It allows you to upload images (base64-encoded), apply various transformations like resizing and adding borders, and then upload the processed image to Google Drive. Additionally, it integrates with WooCommerce to confirm orders and log relevant data into Google Sheets.

## Features
- **Image Manipulation**: Resize and add borders to images (supports custom paper sizes and orientations).
- **Google Drive Integration**: Upload processed images to a specified folder in Google Drive.
- **WooCommerce Integration**: Fetch order details from WooCommerce and confirm orders based on payment status.
- **Google Sheets Logging**: Log order information into Google Sheets for tracking purposes.

## Prerequisites

- **Node.js**: Ensure you have Node.js installed on your machine.
- **Google API Credentials**: You'll need a `keys.json` file with Google Drive and Sheets API credentials.
- **WooCommerce API Credentials**: Ensure you have WooCommerce API keys for order management.

### Setup

1. **Clone the Repository**
   ```bash
   git clone <repository_url>
   cd <repository_folder>
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root directory with the following variables:

   ```
   GOOGLE_DRIVE_FOLDER_ID=<your_drive_folder_id>
   GOOGLE_DRIVE_CONFIRMED_FOLDER_ID=<your_confirmed_folder_id>
   GOOGLE_SHEET_ID=<your_google_sheet_id>
   WOO_BASE_URL=<your_woocommerce_base_url>
   WOO_CONSUMER_KEY=<your_woocommerce_consumer_key>
   WOO_CONSUMER_SECRET=<your_woocommerce_consumer_secret>
   ```

4. **Run the Application**
   Start the server:
   ```bash
   npm start
   ```

   The application will be available at `http://localhost:3000` (or a different port if configured).

## API Endpoints

### 1. `POST /add-border`
This endpoint applies borders and resizes an image based on the given parameters.

#### Request Body
```json
{
  "originalbase64Image": "data:image/png;base64,...",
  "border_size": 10,
  "border_color": "#FF0000",
  "orientation": "Portrait",
  "orderID": "12345",
  "paperSize": "A4",
  "resizeOption": "cover",
  "isCustom": false,
  "sizes": {"width": 600, "height": 800}
}
```

#### Response
```json
{
  "status": "success",
  "border_size": 10,
  "fileId": "1xXYZ...",
  "viewLink": "https://drive.google.com/file/d/1xXYZ/view",
  "originalFileId": "1xABC...",
  "originalViewLink": "https://drive.google.com/file/d/1xABC/view"
}
```

### 2. `POST /confirm-order`
This endpoint confirms an order from WooCommerce, processes the order, and moves related files to the confirmed folder in Google Drive.

#### Request Body
```json
{
  "id": 12345
}
```

#### Response
```json
{
  "message": "Order is confirmed and files moved!",
  "order": { ... },
  "movedFiles": ["12345_Modified.jpg", "12345_Original.jpg"]
}
```

## Key Concepts

- **Image Manipulation**: Images are resized according to specified paper sizes (e.g., A4, A5), and can have borders added in different colors and sizes.
- **Google Drive**: Processed images and original images are uploaded to Google Drive. The app uses the Google Drive API to interact with Drive.
- **WooCommerce**: The app integrates with WooCommerce to fetch order details and confirm the payment status of orders.
- **Google Sheets**: Order details are logged in Google Sheets for easy tracking of processed orders.

## Technologies Used
- **Express**: For handling HTTP requests and routing.
- **Sharp**: For image manipulation (resizing, adding borders).
- **Google APIs**: For Google Drive and Google Sheets interaction.
- **Axios**: For making HTTP requests to WooCommerce.
- **pdf-to-img**: For converting PDF files to images if the uploaded file is a PDF.
- **dotenv**: For loading environment variables from the `.env` file.

## Contributing

Feel free to submit issues, fork the repository, and send pull requests for improvements.

## License

This project is licensed under the MIT License. See the LICENSE file for more information.

## Troubleshooting

- Ensure that all environment variables are set correctly, especially the Google API credentials and WooCommerce API keys.
- Make sure the Google Drive folder IDs and Google Sheets ID are correct.
- Check for any missing dependencies or outdated versions if you encounter errors during installation or runtime.

## Contact

For support or further questions, please reach out to the repository maintainers or create an issue on the GitHub page.