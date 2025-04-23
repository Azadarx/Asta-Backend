// Required dependencies
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import nodemailer from "nodemailer";
import Razorpay from "razorpay";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import cors from "cors";
import { v2 as cloudinary } from 'cloudinary';
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// Configure dotenv
dotenv.config();

// Set up __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS configuration
const allowedOrigins = [
  'https://astaphonicsfuns-quickjoins-projects.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'  // Add any other frontend URLs
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Configure multer storage with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'asta_education_content',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'docx', 'doc', 'pptx', 'mp4'],
  },
});

// Create multer upload instance
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Check if file type is allowed
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png',
      'application/pdf',
      'video/mp4',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, JPG, PNG, PDF, Word, PowerPoint, or MP4 files are allowed.'), false);
    }
  }
});

const { Pool } = pg;

// PostgreSQL Connection - Using environment variables securely
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false // Required for Render PostgreSQL
  }
});

// Test database connection
pool.connect()
  .then(client => {
    console.log('Connected to PostgreSQL database');
    client.release();

    // Create tables if they don't exist
    initializeTables();
  })
  .catch(err => {
    console.error('Error connecting to PostgreSQL database:', err);
  });

// Initialize database tables
async function initializeTables() {
  const client = await pool.connect();
  try {
    // Create students table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        course VARCHAR(100) NOT NULL,
        payment_id VARCHAR(100),
        payment_status VARCHAR(20) DEFAULT 'successful',
        amount DECIMAL(10,2) NOT NULL,
        registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Students table created or already exists');
    // Add this near your other table initialization code in initializeTables()
    await client.query(`
  CREATE TABLE IF NOT EXISTS lms_content (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(50) NOT NULL,
    file_url TEXT NOT NULL,
    storage_path TEXT NOT NULL, 
    file_size BIGINT,
    file_name VARCHAR(255),
    created_by VARCHAR(128) NOT NULL,
    created_by_email VARCHAR(100),
    firebase_id VARCHAR(128),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
    console.log('LMS content table created or already exists');

    // Create contact_messages table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Contact messages table created or already exists');

    // Create about_inquiries table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS about_inquiries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('About inquiries table created or already exists');

    // Create users table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(128) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table created or already exists');

  } catch (err) {
    console.error('Error initializing database tables:', err);
  } finally {
    client.release();
  }
}

// Initialize Razorpay - Using environment variables securely
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET
});

// Nodemailer configuration - Using environment variables securely
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Excel file paths
const excelFilePath = path.join(__dirname, 'data', 'students.xlsx');
const contactExcelPath = path.join(__dirname, 'data', 'contact_messages.xlsx');
const aboutExcelPath = path.join(__dirname, 'data', 'about_inquiries.xlsx');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// Initialize Excel files if not exist
const initExcelFiles = () => {
  // Students Excel file
  if (!fs.existsSync(excelFilePath)) {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet([]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Students');
    xlsx.writeFile(workbook, excelFilePath);
    console.log('Students Excel file created');
  }

  // Contact messages Excel file
  if (!fs.existsSync(contactExcelPath)) {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet([]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contact Messages');
    xlsx.writeFile(workbook, contactExcelPath);
    console.log('Contact messages Excel file created');
  }

  // About inquiries Excel file
  if (!fs.existsSync(aboutExcelPath)) {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet([]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'About Inquiries');
    xlsx.writeFile(workbook, aboutExcelPath);
    console.log('About inquiries Excel file created');
  }
};
initExcelFiles();

// Handle form submission and create Razorpay order
app.post('/create-order', (req, res) => {
  const { name, email, phone, course, amount } = req.body;

  if (!name || !email || !phone || !course || !amount) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Create Razorpay order - Fixed structure according to Razorpay API
  const options = {
    amount: parseFloat(amount) * 100, // amount in paisa
    currency: 'INR',
    receipt: `receipt_${Date.now()}`,
    payment_capture: 1
  };

  razorpay.orders.create(options, (err, order) => {
    if (err) {
      console.error('Error creating Razorpay order:', err);
      return res.status(500).json({ error: 'Error creating order' });
    }

    // Return order details to client WITH proper Razorpay configuration
    res.json({
      order_id: order.id,
      key_id: process.env.RAZORPAY_KEY_ID, // Using env var instead of direct reference
      amount: options.amount,
      currency: options.currency,
      name: 'ASTA Education Academy',
      description: `Course Registration for ${course}`,
      student_info: {
        name,
        email,
        phone,
        course,
        amount
      },
      prefill: {
        name,
        email,
        contact: phone
      },
      // Added: UPI configuration for better app redirects
      config: {
        display: {
          blocks: {
            upi: {
              name: "Pay via UPI",
              instruments: [
                {
                  method: 'upi'
                }
              ]
            }
          },
          sequence: ["block.upi"],
          preferences: {
            show_default_blocks: false
          }
        }
      },
      // Added: Improve app handling for callbacks
      modal: {
        escape: false,
        ondismiss: function () {
          console.log('Payment window closed');
        }
      }
    });
  });
});

// Verify payment and update records
app.post('/verify-payment', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    student_info
  } = req.body;

  // Verify signature
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ status: 'failure', message: 'Invalid signature' });
  }

  // Extract student information
  const { name, email, phone, course, amount } = student_info;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert student record in database AFTER successful payment
    const insertResult = await client.query(
      'INSERT INTO students (name, email, phone, course, amount, payment_id, payment_status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [name, email, phone, course, amount, razorpay_payment_id, 'successful']
    );

    const student_id = insertResult.rows[0].id;

    // Get complete student details with timestamp
    const studentResult = await client.query(
      'SELECT * FROM students WHERE id = $1',
      [student_id]
    );

    if (studentResult.rows.length === 0) {
      throw new Error('Error fetching student details');
    }

    const student = studentResult.rows[0];

    // Update Excel file
    await updateExcelFile(student);

    // Send email notification
    await sendPaymentConfirmationEmail(student);

    await client.query('COMMIT');

    res.json({ status: 'success', message: 'Payment successful and records updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in post-payment processing:', error);
    res.status(500).json({ status: 'error', message: 'Post-payment processing error' });
  } finally {
    client.release();
  }
});

// API endpoint for user creation - Just the modified endpoint
app.post('/api/users', async (req, res) => {
  console.log('Received user creation request:', req.body); // Add logging
  const { uid, name, email, role } = req.body;

  if (!uid || !name || !email || !role) {
    console.log('Missing required fields:', { uid, name, email, role });
    return res.status(400).json({ error: 'All fields are required (uid, name, email, role)' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if user with this uid already exists
    const existingUserResult = await client.query(
      'SELECT * FROM users WHERE uid = $1',
      [uid]
    );

    if (existingUserResult.rows.length > 0) {
      console.log('User already exists with uid:', uid);
      return res.status(409).json({ error: 'User already exists' });
    }

    // Insert the new user
    const insertResult = await client.query(
      'INSERT INTO users (uid, name, email, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [uid, name, email, role]
    );

    await client.query('COMMIT');

    console.log('User created successfully:', { userId: insertResult.rows[0].id });
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      userId: insertResult.rows[0].id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Error creating user: ' + error.message });
  } finally {
    client.release();
  }
});

// New endpoint for file upload to Cloudinary
app.post('/api/lms/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // The file has been uploaded to Cloudinary via the multer storage
    const { title, description, createdBy, createdByEmail } = req.body;
    const fileURL = req.file.path; // Cloudinary URL

    // Get content type based on original mimetype
    let contentType;
    switch (req.file.mimetype) {
      case 'image/jpeg':
      case 'image/jpg':
      case 'image/png':
        contentType = 'image';
        break;
      case 'application/pdf':
        contentType = 'pdf';
        break;
      case 'video/mp4':
        contentType = 'video';
        break;
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        contentType = 'ppt';
        break;
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      case 'application/msword':
        contentType = 'word';
        break;
      default:
        contentType = 'other';
    }

    // Store metadata in PostgreSQL
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO lms_content 
          (title, description, content_type, file_url, storage_path, file_size, file_name, created_by, created_by_email) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING id`,
        [
          title,
          description,
          contentType,
          fileURL,
          req.file.path, // Using path as storage identifier
          req.file.size,
          req.file.originalname,
          createdBy,
          createdByEmail
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Content uploaded successfully',
        contentId: result.rows[0].id,
        fileURL: fileURL
      });
    } catch (error) {
      console.error('Error storing content metadata:', error);

      // Clean up Cloudinary on database failure
      try {
        // Extract public_id from URL
        const publicId = req.file.filename || req.file.public_id;
        await cloudinary.uploader.destroy(publicId);
      } catch (cleanupError) {
        console.error('Error cleaning up Cloudinary resource:', cleanupError);
      }

      res.status(500).json({ error: 'Failed to store content metadata' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Error uploading file: ' + error.message });
  }
});

// Add this new endpoint near your other API routes - replaced with the new upload endpoint above
app.post('/api/lms/content', async (req, res) => {
  const {
    title,
    description,
    contentType,
    fileURL,
    storagePath,
    fileSize,
    fileName,
    createdBy,
    createdByEmail,
    firebaseId
  } = req.body;

  // Validate required fields
  if (!title || !contentType || !fileURL || !storagePath || !createdBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `INSERT INTO lms_content 
        (title, description, content_type, file_url, storage_path, file_size, file_name, created_by, created_by_email, firebase_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id`,
      [title, description, contentType, fileURL, storagePath, fileSize, fileName, createdBy, createdByEmail, firebaseId]
    );

    res.status(201).json({
      success: true,
      message: 'Content uploaded successfully',
      contentId: result.rows[0].id
    });
  } catch (error) {
    console.error('Error storing content metadata:', error);
    res.status(500).json({ error: 'Failed to store content metadata' });
  } finally {
    client.release();
  }
});

// Add endpoint to retrieve content
app.get('/api/lms/content', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM lms_content ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching LMS content:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Contact form submission handler
app.post('/submit-contact', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert into database
    const insertResult = await client.query(
      'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, email, phone || '', subject, message]
    );

    const messageId = insertResult.rows[0].id;

    // Get complete message details with timestamp
    const messageResult = await client.query(
      'SELECT * FROM contact_messages WHERE id = $1',
      [messageId]
    );

    if (messageResult.rows.length === 0) {
      throw new Error('Error fetching contact message details');
    }

    const contactMessage = messageResult.rows[0];

    // Update Excel file
    await updateContactExcel(contactMessage);

    // Send email notification
    await sendContactNotificationEmail(contactMessage);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Your message has been sent successfully!' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in contact form processing:', error);
    res.status(500).json({ error: 'Error processing your message' });
  } finally {
    client.release();
  }
});

// About page form submission handler
app.post('/submit-about-inquiry', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert into database
    const insertResult = await client.query(
      'INSERT INTO about_inquiries (name, email, subject, message) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, subject, message]
    );

    const inquiryId = insertResult.rows[0].id;

    // Get complete inquiry details with timestamp
    const inquiryResult = await client.query(
      'SELECT * FROM about_inquiries WHERE id = $1',
      [inquiryId]
    );

    if (inquiryResult.rows.length === 0) {
      throw new Error('Error fetching about inquiry details');
    }

    const aboutInquiry = inquiryResult.rows[0];

    // Update Excel file
    await updateAboutExcel(aboutInquiry);

    // Send email notification
    await sendAboutInquiryEmail(aboutInquiry);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Your message has been sent successfully!' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in about inquiry processing:', error);
    res.status(500).json({ error: 'Error processing your message' });
  } finally {
    client.release();
  }
});

// Function to update Students Excel file
async function updateExcelFile(student) {
  return new Promise((resolve, reject) => {
    try {
      let workbook;
      let worksheet;

      if (fs.existsSync(excelFilePath)) {
        // Read existing file
        workbook = xlsx.readFile(excelFilePath);
        worksheet = workbook.Sheets['Students'];
      } else {
        // Create new file
        workbook = xlsx.utils.book_new();
        worksheet = xlsx.utils.json_to_sheet([]);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Students');
      }

      // Convert worksheet to JSON to get existing data
      const existingData = worksheet ? xlsx.utils.sheet_to_json(worksheet) : [];

      // Add new student data
      existingData.push({
        ID: student.id,
        Name: student.name,
        Email: student.email,
        Phone: student.phone,
        Course: student.course,
        Amount: student.amount,
        'Payment ID': student.payment_id,
        'Payment Status': student.payment_status,
        'Registration Date': new Date(student.registration_date).toLocaleString()
      });

      // Convert back to worksheet and save
      const newWorksheet = xlsx.utils.json_to_sheet(existingData);
      workbook.Sheets['Students'] = newWorksheet;
      xlsx.writeFile(workbook, excelFilePath);

      console.log('Students Excel file updated successfully');
      resolve();
    } catch (error) {
      console.error('Error updating Students Excel file:', error);
      reject(error);
    }
  });
}

// Function to update Contact Messages Excel file
async function updateContactExcel(contactMessage) {
  return new Promise((resolve, reject) => {
    try {
      let workbook;
      let worksheet;

      if (fs.existsSync(contactExcelPath)) {
        // Read existing file
        workbook = xlsx.readFile(contactExcelPath);
        worksheet = workbook.Sheets['Contact Messages'];
      } else {
        // Create new file
        workbook = xlsx.utils.book_new();
        worksheet = xlsx.utils.json_to_sheet([]);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Contact Messages');
      }

      // Convert worksheet to JSON to get existing data
      const existingData = worksheet ? xlsx.utils.sheet_to_json(worksheet) : [];

      // Add new contact message data
      existingData.push({
        ID: contactMessage.id,
        Name: contactMessage.name,
        Email: contactMessage.email,
        Phone: contactMessage.phone || 'N/A',
        Subject: contactMessage.subject,
        Message: contactMessage.message,
        'Submission Date': new Date(contactMessage.submission_date).toLocaleString()
      });

      // Convert back to worksheet and save
      const newWorksheet = xlsx.utils.json_to_sheet(existingData);
      workbook.Sheets['Contact Messages'] = newWorksheet;
      xlsx.writeFile(workbook, contactExcelPath);

      console.log('Contact Messages Excel file updated successfully');
      resolve();
    } catch (error) {
      console.error('Error updating Contact Messages Excel file:', error);
      reject(error);
    }
  });
}

// Function to update About Inquiries Excel file
async function updateAboutExcel(aboutInquiry) {
  return new Promise((resolve, reject) => {
    try {
      let workbook;
      let worksheet;

      if (fs.existsSync(aboutExcelPath)) {
        // Read existing file
        workbook = xlsx.readFile(aboutExcelPath);
        worksheet = workbook.Sheets['About Inquiries'];
      } else {
        // Create new file
        workbook = xlsx.utils.book_new();
        worksheet = xlsx.utils.json_to_sheet([]);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'About Inquiries');
      }

      // Convert worksheet to JSON to get existing data
      const existingData = worksheet ? xlsx.utils.sheet_to_json(worksheet) : [];

      // Add new about inquiry data
      existingData.push({
        ID: aboutInquiry.id,
        Name: aboutInquiry.name,
        Email: aboutInquiry.email,
        Subject: aboutInquiry.subject,
        Message: aboutInquiry.message,
        'Submission Date': new Date(aboutInquiry.submission_date).toLocaleString()
      });

      // Convert back to worksheet and save
      const newWorksheet = xlsx.utils.json_to_sheet(existingData);
      workbook.Sheets['About Inquiries'] = newWorksheet;
      xlsx.writeFile(workbook, aboutExcelPath);

      console.log('About Inquiries Excel file updated successfully');
      resolve();
    } catch (error) {
      console.error('Error updating About Inquiries Excel file:', error);
      reject(error);
    }
  });
}

// Function to send payment confirmation email
async function sendPaymentConfirmationEmail(student) {
  return new Promise((resolve, reject) => {
    // Prepare email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: student.email,
      bcc: process.env.EMAIL_USER, // Send a copy to admin
      subject: 'Course Registration Confirmation - ASTA Education Academy',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2 style="color: #4b0082; text-align: center;">Registration Confirmation</h2>
          <p>Dear ${student.name},</p>
          <p>Thank you for registering with ASTA Education Academy. Your payment has been successfully processed.</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <h3 style="margin-top: 0; color: #4b0082;">Registration Details:</h3>
            <p><strong>Course:</strong> ${student.course}</p>
            <p><strong>Amount Paid:</strong> ₹${student.amount}</p>
            <p><strong>Payment ID:</strong> ${student.payment_id}</p>
            <p><strong>Registration Date:</strong> ${new Date(student.registration_date).toLocaleString()}</p>
          </div>
          <p>We look forward to providing you with a great learning experience.</p>
          <p>If you have any questions, please don't hesitate to contact us.</p>
          <p>Best regards,<br>ASTA Education Academy Team</p>
        </div>
      `
    };

    // Send email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending payment confirmation email:', error);
        reject(error);
      } else {
        console.log('Payment confirmation email sent:', info.response);
        resolve();
      }
    });
  });
}

// Function to send contact form notification email
async function sendContactNotificationEmail(contactMessage) {
  return new Promise((resolve, reject) => {
    // Prepare email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to admin
      subject: `New Contact Form Submission: ${contactMessage.subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
         <h2 style="color: #4b0082; text-align: center;">New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${contactMessage.name}</p>
          <p><strong>Email:</strong> ${contactMessage.email}</p>
          <p><strong>Phone:</strong> ${contactMessage.phone || 'Not provided'}</p>
          <p><strong>Subject:</strong> ${contactMessage.subject}</p>
          <p><strong>Message:</strong></p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            ${contactMessage.message}
          </div>
          <p>Submitted on: ${new Date(contactMessage.submission_date).toLocaleString()}</p>
        </div>
      `
    };

    // Send email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending contact notification email:', error);
        reject(error);
      } else {
        console.log('Contact notification email sent:', info.response);
        resolve();
      }
    });
  });
}

// Function to send about inquiry notification email
async function sendAboutInquiryEmail(inquiry) {
  return new Promise((resolve, reject) => {
    // Prepare email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to admin
      subject: `New About Page Inquiry: ${inquiry.subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2 style="color: #4b0082; text-align: center;">New About Page Inquiry</h2>
          <p><strong>Name:</strong> ${inquiry.name}</p>
          <p><strong>Email:</strong> ${inquiry.email}</p>
          <p><strong>Subject:</strong> ${inquiry.subject}</p>
          <p><strong>Message:</strong></p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            ${inquiry.message}
          </div>
          <p>Submitted on: ${new Date(inquiry.submission_date).toLocaleString()}</p>
        </div>
      `
    };

    // Send email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending about inquiry notification email:', error);
        reject(error);
      } else {
        console.log('About inquiry notification email sent:', info.response);
        resolve();
      }
    });
  });
}

// Get all students
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students ORDER BY registration_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching student data:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all contact messages
app.get('/api/contact-messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contact_messages ORDER BY submission_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching contact messages:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all about inquiries
app.get('/api/about-inquiries', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM about_inquiries ORDER BY submission_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching about inquiries:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete LMS content endpoint
app.delete('/api/lms/content/:id', async (req, res) => {
  const contentId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // First, get the content information to access the Cloudinary path
    const contentResult = await client.query(
      'SELECT * FROM lms_content WHERE id = $1',
      [contentId]
    );

    if (contentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const content = contentResult.rows[0];

    // Extract public ID from Cloudinary URL
    // The URL looks like: https://res.cloudinary.com/cloud_name/image/upload/v1234567890/folder/file.jpg
    // We need to extract the 'folder/file.jpg' part which is the public ID
    try {
      const urlParts = content.file_url.split('/');
      const uploadIndex = urlParts.indexOf('upload');

      if (uploadIndex !== -1 && uploadIndex < urlParts.length - 2) {
        // Extract the public ID (everything after the /upload/vXXXXXXX/ part)
        const publicIdParts = urlParts.slice(uploadIndex + 2);
        const publicId = publicIdParts.join('/');

        // Delete from Cloudinary
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (cloudinaryError) {
      console.error('Error deleting from Cloudinary:', cloudinaryError);
      // Continue with database deletion even if Cloudinary delete fails
    }

    // Now delete from database
    await client.query(
      'DELETE FROM lms_content WHERE id = $1',
      [contentId]
    );

    await client.query('COMMIT');

    res.json({ success: true, message: 'Content deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting content:', error);
    res.status(500).json({ error: 'Error deleting content' });
  } finally {
    client.release();
  }
});

// Get users endpoint with filtering
app.get('/api/users', async (req, res) => {
  const { role } = req.query;
  let query = 'SELECT * FROM users';
  const params = [];

  if (role) {
    query += ' WHERE role = $1';
    params.push(role);
  }

  query += ' ORDER BY created_at DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Serve the Excel files if needed (e.g., for admin download)
app.get('/api/download/students', (req, res) => {
  if (fs.existsSync(excelFilePath)) {
    res.download(excelFilePath);
  } else {
    res.status(404).json({ error: 'Students data file not found' });
  }
});

app.get('/api/download/contact-messages', (req, res) => {
  if (fs.existsSync(contactExcelPath)) {
    res.download(contactExcelPath);
  } else {
    res.status(404).json({ error: 'Contact messages file not found' });
  }
});

app.get('/api/download/about-inquiries', (req, res) => {
  if (fs.existsSync(aboutExcelPath)) {
    res.download(aboutExcelPath);
  } else {
    res.status(404).json({ error: 'About inquiries file not found' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});