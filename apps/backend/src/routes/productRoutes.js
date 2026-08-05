import express from "express";

import { getAllProducts , getProductById , getRelatedProducts} from "../controllers/productController.js";

const router = express.Router();

router.get("/",getAllProducts);
router.get("/related", getRelatedProducts);
router.get("/:id", getProductById);
export default router;