import express from "express";

import { getAllProducts , getProductById , getRelatedProducts , searchAllProducts , getProductsByCategory } from "../controllers/productController.js";

const router = express.Router();

router.get("/",getAllProducts);
router.get("/search", searchAllProducts);
router.get("/related", getRelatedProducts);
router.get("/category/:categoryId", getProductsByCategory);
router.get("/:id", getProductById);
export default router;