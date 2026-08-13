import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import addressRoutes from "./routes/addressRoute.js";

import productRoutes from "./routes/productRoutes.js";
import authRoutes from "./routes/authRoute.js";


const app = express();

app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

app.use("/api/products", productRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/addresses", addressRoutes);

app.get("/", (req, res) => {
  res.send("Backend is running");
});

export default app;