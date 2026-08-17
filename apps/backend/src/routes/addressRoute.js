import express from "express";
import { getAddresses  , saveAddress , updateAddress ,  deleteAddress} from "../controllers/addressController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth, getAddresses);
router.post("/", requireAuth, saveAddress);
router.put("/:id", requireAuth, updateAddress);
router.delete("/:id", requireAuth, deleteAddress);

export default router;