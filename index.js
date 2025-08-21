require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Schemas for Shoes, Bags, Dresses
const baseSchema = {
  name: String,
  color: String,
  stock: Number,
  price: Number,
  description: String,
  image_url: String,
};

const shoesSchema = new mongoose.Schema(
  {
    ...baseSchema,
    gender: {
      type: String,
      enum: ["male", "female", "unisex"],
      default: "unisex",
    },
    ageGroup: { type: String, enum: ["adult", "child"], default: "adult" },
    sizes: {
      US: String,
      UK: String,
      EU: String,
      CM: String,
    },
  },
  { timestamps: true }
);

const bagsSchema = new mongoose.Schema(baseSchema, { timestamps: true });
const dressesSchema = new mongoose.Schema(baseSchema, { timestamps: true });

const Shoes = mongoose.model("Shoes", shoesSchema);
const Bags = mongoose.model("Bags", bagsSchema);
const Dresses = mongoose.model("Dresses", dressesSchema);

// Sales Schema
const salesSchema = new mongoose.Schema({
  productId: mongoose.Schema.Types.ObjectId,
  category: String,
  name: String,
  quantity: Number,
  price: Number,
  total: Number,
  type: { type: String, enum: ["add", "deduct"], default: "deduct" },
  date: { type: Date, default: Date.now },
});
const Sale = mongoose.model("Sale", salesSchema);

// Shoes CRUD
app.get("/api/shoes", async (req, res) => {
  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const total = await Shoes.countDocuments();
  const shoes = await Shoes.find().skip(skip).limit(limit);
  res.json({
    data: shoes,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

// Get single shoe by ID
app.get("/api/shoes/:id", async (req, res) => {
  try {
    const shoe = await Shoes.findById(req.params.id);
    if (!shoe) return res.status(404).json({ error: "Shoe not found" });
    res.json(shoe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/shoes", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      color,
      stock,
      price,
      description,
      image_url: imageUrlFromBody,
      gender,
      ageGroup,
      sizes,
    } = req.body;
    let image_url = imageUrlFromBody || "";
    if (req.file) {
      image_url = `/uploads/${req.file.filename}`;
    }
    const shoe = new Shoes({
      name,
      color,
      stock,
      price,
      description,
      image_url,
      gender,
      ageGroup,
      sizes,
    });
    await shoe.save();
    // Record addition
    const sale = new Sale({
      productId: shoe._id,
      category: "Shoes",
      quantity: stock,
      revenue: 0,
      total: price * stock,
      type: "add",
      action: "added",
      date: new Date(),
    });
    await sale.save();
    res.status(201).json(shoe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Get all bags
app.get("/api/bags", async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const total = await Bags.countDocuments();
    const bags = await Bags.find().skip(skip).limit(limit);
    res.json({
      data: bags,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/bags/:id", async (req, res) => {
  try {
    const bag = await Bags.findById(req.params.id);
    if (!bag) return res.status(404).json({ error: "Bag not found" });
    res.json(bag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bags", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      color,
      size,
      stock,
      price,
      description,
      image_url: imageUrlFromBody,
    } = req.body;
    let image_url = imageUrlFromBody || "";
    if (req.file) {
      image_url = `/uploads/${req.file.filename}`;
    }
    const bag = new Bags({
      name,
      color,
      size,
      stock,
      price,
      description,
      image_url,
    });
    await bag.save();
    // Record addition
    const sale = new Sale({
      productId: bag._id,
      category: "Bags",
      name: bag.name,
      quantity: stock,
      price: price,
      total: price * stock,
      type: "add",
    });
    await sale.save();
    res.status(201).json(bag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deduct stock from a bag
// Add stock to a bag
app.post("/api/bags/:id/add", async (req, res) => {
  try {
    const bag = await Bags.findById(req.params.id); // <-- FIXED
    if (!bag) return res.status(404).json({ error: "Bag not found" });
    const quantity = parseInt(req.body.quantity, 10);
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: "Invalid quantity" });
    bag.stock += quantity;
    await bag.save();
    // Log the addition
    await Sale.create({
      productId: bag._id,
      category: "Bags",
      name: bag.name,
      quantity,
      price: bag.price,
      total: 0,
      type: "add",
      date: new Date(),
      action: "added",
    });
    res.json({ stock: bag.stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/bags/:id/deduct", async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: "Invalid quantity" });
    const bag = await Bags.findById(req.params.id);
    if (!bag) return res.status(404).json({ error: "Bag not found" });
    if (bag.stock < quantity)
      return res.status(400).json({ error: "Not enough stock" });
    bag.stock -= quantity;
    await bag.save();
    // Record deduction
    const sale = new Sale({
      productId: bag._id,
      category: "Bags",
      name: bag.name,
      quantity,
      price: bag.price,
      total: bag.price * quantity,
      type: "deduct",
      date: new Date(),
    });
    await sale.save();
    res.json(bag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/dresses/:id", async (req, res) => {
  try {
    const dress = await Dresses.findById(req.params.id);
    if (!dress) return res.status(404).json({ error: "Dress not found" });
    res.json(dress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/dresses", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      color,
      size,
      stock,
      price,
      description,
      image_url: imageUrlFromBody,
    } = req.body;
    let image_url = imageUrlFromBody || "";
    if (req.file) {
      image_url = `/uploads/${req.file.filename}`;
    }
    const dress = new Dresses({
      name,
      color,
      size,
      stock,
      price,
      description,
      image_url,
    });
    await dress.save();
    // Record addition
    const sale = new Sale({
      productId: dress._id,
      category: "Dresses",
      name: dress.name,
      quantity: stock,
      price: price,
      total: price * stock,
      type: "add",
    });
    await sale.save();
    res.status(201).json(dress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/dresses/:id/add", async (req, res) => {
  try {
    const dress = await Dresses.findById(req.params.id); // <-- FIXED
    if (!dress) return res.status(404).json({ error: "Dress not found" });
    const quantity = parseInt(req.body.quantity, 10);
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: "Invalid quantity" });
    dress.stock += quantity;
    await dress.save();
    // Log the addition
    await Sale.create({
      productId: dress._id,
      category: "Dresses",
      name: dress.name,
      quantity,
      price: dress.price,
      total: 0,
      type: "add",
      date: new Date(),
      action: "added",
    });
    res.json({ stock: dress.stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ...existing code...
app.post("/api/dresses/:id/deduct", async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: "Invalid quantity" });
    const dress = await Dresses.findById(req.params.id);
    if (!dress) return res.status(404).json({ error: "Dress not found" });
    if (dress.stock < quantity)
      return res.status(400).json({ error: "Not enough stock" });
    dress.stock -= quantity;
    await dress.save();
    // Record deduction
    const sale = new Sale({
      productId: dress._id,
      category: "Dresses",
      name: dress.name,
      quantity,
      price: dress.price,
      total: dress.price * quantity,
      type: "deduct",
      date: new Date(),
    });
    await sale.save();
    res.json(dress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dresses", async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const total = await Dresses.countDocuments();
    const dresses = await Dresses.find().skip(skip).limit(limit);
    res.json({
      data: dresses,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/sales/logs", async (req, res) => {
  try {
    const { start, end, productId } = req.query;
    let filter = {};
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = new Date(start);
      if (end) filter.date.$lte = new Date(end);
    }
    if (productId) {
      filter.productId = productId;
    }
    const logs = await Sale.find(filter).sort({ date: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update shoe by ID
app.put("/api/shoes/:id", async (req, res) => {
  try {
    const shoe = await Shoes.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!shoe) return res.status(404).json({ error: "Shoe not found" });
    res.json(shoe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete shoe by ID
app.delete("/api/shoes/:id", async (req, res) => {
  try {
    const shoe = await Shoes.findByIdAndDelete(req.params.id);
    if (!shoe) return res.status(404).json({ error: "Shoe not found" });
    res.json({ message: "Shoe deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deduct stock from a shoe
// Add stock to a shoe
app.post("/api/shoes/:id/add", async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: "Invalid quantity" });
    const shoe = await Shoes.findById(req.params.id);
    if (!shoe) return res.status(404).json({ error: "Shoe not found" });
    shoe.stock += quantity;
    await shoe.save();
    // Record addition
    const sale = new Sale({
      productId: shoe._id,
      category: "Shoes",
      name: shoe.name,
      quantity,
      price: shoe.price,
      total: shoe.price * quantity,
      type: "add",
      date: new Date(),
      action: "added",
    });
    await sale.save();
    res.json(shoe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/shoes/:id/deduct", async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: "Invalid quantity" });
    const shoe = await Shoes.findById(req.params.id);
    if (!shoe) return res.status(404).json({ error: "Shoe not found" });
    if (shoe.stock < quantity)
      return res.status(400).json({ error: "Not enough stock" });
    shoe.stock -= quantity;
    await shoe.save();
    // Record deduction
    const sale = new Sale({
      productId: shoe._id,
      category: "Shoes",
      name: shoe.name,
      quantity,
      price: shoe.price,
      total: shoe.price * quantity,
      type: "deduct",
      date: new Date(),
    });
    await sale.save();
    res.json(shoe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
