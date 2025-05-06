const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require('node-cron');
const session = require('express-session');

const app = express();
const port = 5002;

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));
app.use(express.json());

mongoose.connect("mongodb://localhost:27017/Keep-clone")
  .then(() => {
    console.log('MongoDB connected successfully!');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// ================== session ==================

app.use(session({
  secret: "keep_clone_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // secure: true in production with HTTPS
}));

const userSchema = new mongoose.Schema({
  email: String,
  password: String, // store hashed passwords in production
});

const User = mongoose.model("User", userSchema);

// ----------- Registration -----------
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const existingUser = await User.findOne({ email });
  if (existingUser) return res.status(400).json({ message: "User already exists" });

  const user = new User({ email, password }); // 🔐 Hash password in real apps
  await user.save();
  req.session.userId = user._id;
  res.status(201).json({ message: "Registered successfully" });
});

// Check login status
app.get("/check-login", (req, res) => {
  if (req.session.userId) {
    res.status(200).json({ loggedIn: true });
  } else {
    res.status(200).json({ loggedIn: false });
  }
});

// ----------- Login -----------
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.password !== password) { // 🔐 Use bcrypt in real apps
    return res.status(400).json({ message: "Invalid credentials" });
  }
  req.session.userId = user._id;
  res.status(200).json({ message: "Logged in successfully" });
});

// ----------- Logout -----------
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully" });
  });
});

// ================== Note Schema ==================
const noteSchema = new mongoose.Schema({
  title: String,
  content: String,
  archived: { type: Boolean, default: false }, // ✅ Moved this here directly instead of using schema.add later
  deletedAt: { type: Date, default: null },
});

const Note = mongoose.model("Note", noteSchema);

// ================== Reminder Schema ==================
const reminderSchema = new mongoose.Schema({
  note: String,
  reminderTime: Date,
}, { timestamps: true });

const Reminder = mongoose.model("Reminder", reminderSchema);

// ================== Routes ==================
app.get("/", (req, res) => {
  res.send("API is running...");
});

// ----------- Note Routes -----------
app.get("/notes", async (req, res) => {
  try {
    const notes = await Note.find({ archived: false });  // Correct filter
    res.json(notes);
  } catch (err) {
    res.status(500).json({ message: "Error fetching notes" });
  }
});

app.post("/notes", async (req, res) => {
  const { title, content } = req.body;
  const note = new Note({ title, content });
  await note.save();
  res.status(201).json(note);
});

// ----------- Reminder Routes -----------
// Create a reminder
app.post("/reminders", async (req, res) => {
  try {
    const { note, reminderTime } = req.body;

    if (!note || !reminderTime) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const reminder = new Reminder({
      note,
      reminderTime: new Date(reminderTime),
    });

    await reminder.save();
    res.status(201).json({ message: "Reminder set successfully", reminder });
  } catch (error) {
    console.error("Error setting reminder:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get all reminders
app.get("/reminders", async (req, res) => {
  try {
    const reminders = await Reminder.find().sort({ reminderTime: 1 });
    res.status(200).json(reminders);
  } catch (err) {
    console.error("Error fetching reminders:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Update reminder if it has passed
app.patch("/reminders/:id", async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);
    
    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }
    
    const currentTime = new Date();
    if (reminder.reminderTime < currentTime) {
      // If reminder time has passed, "cut down" to the current time
      reminder.reminderTime = currentTime;
    }

    await reminder.save();
    res.status(200).json(reminder);
  } catch (error) {
    console.error("Error updating reminder:", error);
    res.status(500).json({ message: "Error updating reminder" });
  }
});

// Delete reminder
app.delete("/reminders/:id", async (req, res) => {
  try {
    const reminder = await Reminder.findByIdAndDelete(req.params.id);
    
    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    res.status(200).json({ message: "Reminder deleted successfully" });
  } catch (error) {
    console.error("Error deleting reminder:", error);
    res.status(500).json({ message: "Error deleting reminder" });
  }
});

// ================== Archive Routes ==================
app.patch("/notes/:id/archive", async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(
      req.params.id,
      { archived: true },
      { new: true }
    );
    if (!updatedNote) return res.status(404).json({ message: "Note not found" });
    res.status(200).json(updatedNote);
  } catch (error) {
    console.error("Error archiving note:", error);
    res.status(500).json({ error: "Server error while archiving note" });
  }
});

app.patch("/notes/:id/unarchive", async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(
      req.params.id,
      { archived: false },
      { new: true }
    );
    if (!updatedNote) return res.status(404).json({ message: "Note not found" });
    res.status(200).json(updatedNote);
  } catch (error) {
    console.error("Error unarchiving note:", error);
    res.status(500).json({ error: "Server error while unarchiving note" });
  }
});

app.get("/archived-notes", async (req, res) => {
  try {
    const archivedNotes = await Note.find({ archived: true });
    res.status(200).json(archivedNotes);
  } catch (error) {
    console.error("Error fetching archived notes:", error);
    res.status(500).json({ error: "Server error while fetching archived notes" });
  }
});

// ----------- Trash Notes -----------
app.delete("/notes/:id", async (req, res) => {
  const { id } = req.params;
  const note = await Note.findById(id);
  
  // Soft delete: Update the 'deletedAt' field
  note.deletedAt = new Date();
  await note.save();

  res.status(200).json(note);
});

app.get("/trash", async (req, res) => {
  try {
    const trashNotes = await Note.find({ deletedAt: { $ne: null } });
    res.status(200).json(trashNotes);
  } catch (err) {
    res.status(500).json({ message: "Error fetching trash notes" });
  }
});

app.patch("/notes/:id/restore", async (req, res) => {
  const { id } = req.params;
  const note = await Note.findById(id);

  if (note.deletedAt === null) {
    return res.status(400).json({ message: "Note is not deleted" });
  }

  // Restore the note
  note.deletedAt = null;
  await note.save();

  res.status(200).json(note);
});

// ================== CRON JOB TO DELETE OLD TRASH NOTES ==================
cron.schedule('0 0 * * *', async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await Note.deleteMany({ deletedAt: { $lte: sevenDaysAgo } });
  console.log("🗑️ Deleted notes older than 7 days from trash.");
});

// ================== Start Server ==================
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});