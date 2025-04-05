// Required dependencies
import express from "express";
import bodyParser from "body-parser";
import mysql from "mysql2";
import nodemailer from "nodemailer";
import Razorpay from "razorpay";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import cors from "cors";

// Configure dotenv
dotenv.config();

// Set up __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
app.use(cors({
  origin: 'http://localhost:5173', // Your frontend URL
  methods: ['GET', 'POST'],
  credentials: true
}));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// MySQL Connection
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'asta_education'
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL database:', err);
    return;
  }
  console.log('Connected to MySQL database');

  // Create students table if not exists
  const createStudentsTableQuery = `
    CREATE TABLE IF NOT EXISTS students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      course VARCHAR(100) NOT NULL,
      payment_id VARCHAR(100),
      payment_status VARCHAR(20) DEFAULT 'successful',
      amount DECIMAL(10,2) NOT NULL,
      registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createStudentsTableQuery, (err) => {
    if (err) {
      console.error('Error creating students table:', err);
    } else {
      console.log('Students table created or already exists');
    }
  });

  // Create contact_messages table if not exists
  const createContactTableQuery = `
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      subject VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createContactTableQuery, (err) => {
    if (err) {
      console.error('Error creating contact_messages table:', err);
    } else {
      console.log('Contact messages table created or already exists');
    }
  });

  // Create about_inquiries table if not exists
  const createAboutTableQuery = `
    CREATE TABLE IF NOT EXISTS about_inquiries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      subject VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createAboutTableQuery, (err) => {
    if (err) {
      console.error('Error creating about_inquiries table:', err);
    } else {
      console.log('About inquiries table created or already exists');
    }
  });
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'your_razorpay_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_razorpay_key_secret'
});

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'phonicswithshereen@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your_app_password'
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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle form submission and create Razorpay order
app.post('/create-order', (req, res) => {
  const { name, email, phone, course, amount } = req.body;

  if (!name || !email || !phone || !course || !amount) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Create Razorpay order
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

    // Return order details to client WITHOUT storing in database
    res.json({
      order_id: order.id,
      key_id: razorpay.key_id,
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
      }
    });
  });
});

// Route for payment page
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// Verify payment and update records
app.post('/verify-payment', (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    student_info
  } = req.body;

  // Verify signature
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', razorpay.key_secret)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ status: 'failure', message: 'Invalid signature' });
  }

  // Extract student information
  const { name, email, phone, course, amount } = student_info;

  // Insert student record in database AFTER successful payment
  db.query(
    'INSERT INTO students (name, email, phone, course, amount, payment_id, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, email, phone, course, amount, razorpay_payment_id, 'successful'],
    async (err, result) => {
      if (err) {
        console.error('Error storing student data:', err);
        return res.status(500).json({ status: 'error', message: 'Database error' });
      }

      const student_id = result.insertId;

      // Get complete student details with timestamp
      db.query(
        'SELECT * FROM students WHERE id = ?',
        [student_id],
        async (err, results) => {
          if (err || results.length === 0) {
            console.error('Error fetching student details:', err);
            return res.status(500).json({ status: 'error', message: 'Error fetching student details' });
          }

          const student = results[0];

          try {
            // Update Excel file
            await updateExcelFile(student);

            // Send email notification
            await sendPaymentConfirmationEmail(student);

            res.json({ status: 'success', message: 'Payment successful and records updated' });
          } catch (error) {
            console.error('Error in post-payment processing:', error);

            // Delete the record if Excel or email fails
            db.query('DELETE FROM students WHERE id = ?', [student_id], (delErr) => {
              if (delErr) {
                console.error('Error deleting incomplete record:', delErr);
              }
            });

            res.status(500).json({ status: 'error', message: 'Post-payment processing error' });
          }
        }
      );
    }
  );
});

// Contact form submission handler
app.post('/submit-contact', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required' });
  }

  try {
    // Insert into database
    db.query(
      'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone || '', subject, message],
      async (err, result) => {
        if (err) {
          console.error('Error storing contact message:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const messageId = result.insertId;

        // Get complete message details with timestamp
        db.query(
          'SELECT * FROM contact_messages WHERE id = ?',
          [messageId],
          async (err, results) => {
            if (err || results.length === 0) {
              console.error('Error fetching contact message details:', err);
              return res.status(500).json({ error: 'Error fetching message details' });
            }

            const contactMessage = results[0];

            try {
              // Update Excel file
              await updateContactExcel(contactMessage);

              // Send email notification
              await sendContactNotificationEmail(contactMessage);

              res.json({ success: true, message: 'Your message has been sent successfully!' });
            } catch (error) {
              console.error('Error in contact form processing:', error);
              res.status(500).json({ error: 'Error processing your message' });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error('Error in contact form submission:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// About page form submission handler
app.post('/submit-about-inquiry', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required' });
  }

  try {
    // Insert into database
    db.query(
      'INSERT INTO about_inquiries (name, email, subject, message) VALUES (?, ?, ?, ?)',
      [name, email, subject, message],
      async (err, result) => {
        if (err) {
          console.error('Error storing about inquiry:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const inquiryId = result.insertId;

        // Get complete inquiry details with timestamp
        db.query(
          'SELECT * FROM about_inquiries WHERE id = ?',
          [inquiryId],
          async (err, results) => {
            if (err || results.length === 0) {
              console.error('Error fetching about inquiry details:', err);
              return res.status(500).json({ error: 'Error fetching inquiry details' });
            }

            const aboutInquiry = results[0];

            try {
              // Update Excel file
              await updateAboutExcel(aboutInquiry);

              // Send email notification
              await sendAboutInquiryEmail(aboutInquiry);

              res.json({ success: true, message: 'Your message has been sent successfully!' });
            } catch (error) {
              console.error('Error in about inquiry processing:', error);
              res.status(500).json({ error: 'Error processing your message' });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error('Error in about inquiry submission:', error);
    res.status(500).json({ error: 'Server error' });
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
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Name:</strong> ${contactMessage.name}</p>
            <p><strong>Email:</strong> ${contactMessage.email}</p>
            <p><strong>Phone:</strong> ${contactMessage.phone || 'Not provided'}</p>
            <p><strong>Subject:</strong> ${contactMessage.subject}</p>
            <p><strong>Message:</strong> ${contactMessage.message}</p>
            <p><strong>Submission Date:</strong> ${new Date(contactMessage.submission_date).toLocaleString()}</p>
          </div>
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
async function sendAboutInquiryEmail(aboutInquiry) {
  return new Promise((resolve, reject) => {
    // Prepare email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to admin
      subject: `New About Page Inquiry: ${aboutInquiry.subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2 style="color: #4b0082; text-align: center;">New About Page Inquiry</h2>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Name:</strong> ${aboutInquiry.name}</p>
            <p><strong>Email:</strong> ${aboutInquiry.email}</p>
            <p><strong>Subject:</strong> ${aboutInquiry.subject}</p>
            <p><strong>Message:</strong> ${aboutInquiry.message}</p>
            <p><strong>Submission Date:</strong> ${new Date(aboutInquiry.submission_date).toLocaleString()}</p>
          </div>
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

// Admin dashboard route (protected - in a production app this should have proper authentication)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API route to get all students
app.get('/api/students', (req, res) => {
  db.query('SELECT * FROM students ORDER BY registration_date DESC', (err, results) => {
    if (err) {
      console.error('Error fetching students:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// API route to get all contact messages
app.get('/api/contact-messages', (req, res) => {
  db.query('SELECT * FROM contact_messages ORDER BY submission_date DESC', (err, results) => {
    if (err) {
      console.error('Error fetching contact messages:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// API route to get all about inquiries
app.get('/api/about-inquiries', (req, res) => {
  db.query('SELECT * FROM about_inquiries ORDER BY submission_date DESC', (err, results) => {
    if (err) {
      console.error('Error fetching about inquiries:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// API route to download Excel files
app.get('/api/download/:file', (req, res) => {
  const { file } = req.params;
  let filePath;

  switch (file) {
    case 'students':
      filePath = excelFilePath;
      break;
    case 'contact':
      filePath = contactExcelPath;
      break;
    case 'about':
      filePath = aboutExcelPath;
      break;
    default:
      return res.status(404).json({ error: 'File not found' });
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.end((err) => {
    if (err) {
      console.error('Error closing database connection:', err);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});