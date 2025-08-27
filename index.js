require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const app = express();

app.use(cors({
  origin: "http://localhost:5173"
}));
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


// Dashboard Statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build sale query only if date filter is present
    let saleQuery = {};
    if (startDate || endDate) {
      saleQuery.date = {};
      if (startDate) saleQuery.date.$gte = new Date(startDate);
      if (endDate) saleQuery.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    // Get all products and sales
    const [shoes, bags, dresses, sales] = await Promise.all([
      Shoes.find({}),
      Bags.find({}),
      Dresses.find({}),
      Object.keys(saleQuery).length > 0
        ? Sale.find(saleQuery).sort({ date: 1 })
        : Sale.find({}).sort({ date: 1 })
    ]);

    const allProducts = [...shoes, ...bags, ...dresses];
    const salesData = sales.filter(sale => sale.type === 'deduct');
    const restockData = sales.filter(sale => sale.type === 'add');

    // Calculate summary statistics
    const summary = {
      totalProducts: allProducts.length,
      totalStock: allProducts.reduce((sum, p) => sum + p.stock, 0),
      totalValue: allProducts.reduce((sum, p) => sum + (p.price * p.stock), 0),
      totalSales: salesData.reduce((sum, s) => sum + s.quantity, 0),
      totalRevenue: salesData.reduce((sum, s) => sum + s.total, 0),
      totalRestocked: restockData.reduce((sum, r) => sum + r.quantity, 0)
    };

    // Sales by category
    const salesByCategory = {};
    salesData.forEach(sale => {
      salesByCategory[sale.category] = (salesByCategory[sale.category] || 0) + sale.quantity;
    });

    // Sales trend (last 7 days)
    const today = new Date();
    const salesTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const daySales = salesData.filter(sale =>
        sale.date.toISOString().split('T')[0] === dateStr
      );

      salesTrend.push({
        date: dateStr,
        sales: daySales.reduce((sum, s) => sum + s.quantity, 0),
        revenue: daySales.reduce((sum, s) => sum + s.total, 0)
      });
    }

    // Low stock items
    const lowStockItems = allProducts
      .filter(p => p.stock <= 5)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        stock: p.stock,
        price: p.price,
        category: p.constructor.modelName
      }));

    // Top selling products
    const productSales = {};
    salesData.forEach(sale => {
      productSales[sale.name] = (productSales[sale.name] || 0) + sale.quantity;
    });
    const topSelling = Object.entries(productSales)
      .map(([name, quantity]) => {
        const productSalesArr = salesData.filter(s => s.name === name);
        return {
          name,
          quantity,
          revenue: productSalesArr.reduce((sum, s) => sum + s.total, 0)
        };
      })
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Stock value by category
    const stockValueByCategory = {};
    allProducts.forEach(product => {
      const category = product.constructor.modelName;
      stockValueByCategory[category] = (stockValueByCategory[category] || 0) + (product.price * product.stock);
    });

    res.json({
      summary,
      salesByCategory,
      salesTrend,
      lowStockItems,
      topSelling,
      stockValueByCategory
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});
// Inventory Status
app.get('/api/dashboard/inventory-status', async (req, res) => {
  try {
    const [shoes, bags, dresses] = await Promise.all([
      Shoes.find({}),
      Bags.find({}),
      Dresses.find({})
    ]);

    const allProducts = [...shoes, ...bags, ...dresses];
    
    // Stock status
    const stockStatus = {
      inStock: allProducts.filter(p => p.stock > 0).length,
      lowStock: allProducts.filter(p => p.stock > 0 && p.stock <= 5).length,
      outOfStock: allProducts.filter(p => p.stock === 0).length
    };

    // Stock value by category
    const stockValueByCategory = {};
    allProducts.forEach(product => {
      const category = product.constructor.modelName;
      stockValueByCategory[category] = (stockValueByCategory[category] || 0) + (product.price * product.stock);
    });

    res.json({
      totalProducts: allProducts.length,
      stockStatus,
      stockValueByCategory
    });
  } catch (error) {
    console.error('Error fetching inventory status:', error);
    res.status(500).json({ error: 'Failed to fetch inventory status' });
  }
});

// Sales Analytics
app.get('/api/dashboard/sales-analytics', async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const now = new Date();
    const startDate = new Date(now);
    
    switch (period) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(now.getMonth() - 1);
    }

    const sales = await Sale.find({
      date: { $gte: startDate },
      type: 'deduct'
    }).sort({ date: 1 });

    // Group sales by time period
    const groupedSales = {};
    sales.forEach(sale => {
      let key;
      if (period === 'week') {
        key = sale.date.toISOString().split('T')[0]; // Daily for week view
      } else if (period === 'month') {
        key = `Week ${Math.ceil(sale.date.getDate() / 7)}`; // Weekly for month view
      } else {
        key = sale.date.toLocaleString('default', { month: 'short' }); // Monthly for year view
      }
      
      if (!groupedSales[key]) {
        groupedSales[key] = { sales: 0, revenue: 0 };
      }
      groupedSales[key].sales += sale.quantity;
      groupedSales[key].revenue += sale.total;
    });

    res.json({
      period,
      startDate,
      endDate: now,
      data: groupedSales
    });
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({ error: 'Failed to fetch sales analytics' });
  }
});

///End of Dashboard Stats



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
app.get("/api/shoes/grouped", async (req, res) => {
  
  try {
    const shoes = await Shoes.find();
    const grouped = {};
    shoes.forEach((shoe) => {
      if (!grouped[shoe.name]) grouped[shoe.name] = [];
      grouped[shoe.name].push(shoe);
    });
    res.json(grouped);
  } catch (err) {
    console.error("Grouped shoes error:", err);
    res.status(500).json({ error: err.message });
  }
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
// Deduct stock from a dress
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




// Group Bags by Name
app.get("/api/bags/grouped", async (req, res) => {
  try {
    const bags = await Bags.find();
    const grouped = bags.reduce((acc, bag) => {
      acc[bag.name] = acc[bag.name] || [];
      acc[bag.name].push(bag);
      return acc;
    }, {});
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Group Dresses by Name
app.get("/api/dresses/grouped", async (req, res) => {
  try {
    const dresses = await Dresses.find();
    const grouped = dresses.reduce((acc, dress) => {
      acc[dress.name] = acc[dress.name] || [];
      acc[dress.name].push(dress);
      return acc;
    }, {});
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//dashboard stats

// Add these new routes to your existing index.js file



const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
