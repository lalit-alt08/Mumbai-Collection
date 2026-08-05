import jwt from "jsonwebtoken";
import { createCustomer, getCustomerByEmail } from "../services/authService.js";

export const register = async (req, res) => {
  try {
    const { first_name, last_name, email, password } = req.body;

    const existingCustomer = await getCustomerByEmail(email);

    if (existingCustomer.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const customer = await createCustomer({
      first_name,
      last_name,
      email,
      password,
    });

    const token = jwt.sign(
      {
        id: customer.id,
        email: customer.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN,
      }
    );

    res.status(201).json({
      success: true,
      token,
      customer,
    });
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};