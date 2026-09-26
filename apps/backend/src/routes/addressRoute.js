import express from "express";
import { getAddresses  , saveAddress , updateAddress ,  deleteAddress} from "../controllers/addressController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { schemas, validateRequest } from "../middlewares/requestValidation.js";

const router = express.Router();

router.get("/", requireAuth("customer"), getAddresses);
router.post("/", validateRequest({ body: schemas.address }), requireAuth("customer"), saveAddress);
router.put("/:id", validateRequest({ params: schemas.addressIdParam, body: schemas.address }), requireAuth("customer"), updateAddress);
router.delete("/:id", validateRequest({ params: schemas.addressIdParam }), requireAuth("customer"), deleteAddress);

export default router;
