import express from "express";
import { getAddresses  , saveAddress , updateAddress ,  deleteAddress} from "../controllers/addressController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth("customer"), getAddresses);
router.post("/", requireAuth("customer"), saveAddress);
router.put("/:id", requireAuth("customer"), updateAddress);
router.delete("/:id", requireAuth("customer"), deleteAddress);

export default router;