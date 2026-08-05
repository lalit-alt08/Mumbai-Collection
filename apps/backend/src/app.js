import express from "express";
import cors from "cors";
import productRoutes from "./routes/productRoutes.js";
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/products", productRoutes);



app.get("/", (req, res) => {
  res.send("Backend is running ");
});

app.get("/api/health",(req,res) => {
    res.json({
        success : true,
        message : " Server is healthy"
    });
});

export default app;