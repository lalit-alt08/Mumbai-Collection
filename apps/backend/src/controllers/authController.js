import https from "https";
import axios from "axios";

const agent = new https.Agent({
  rejectUnauthorized: false,
});

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const response = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/login`,
      {
        email,
        password,
      },
      {
        httpsAgent: agent,
      },
    );

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data);
    console.log(error.message);

    res.status(401).json({
      success: false,
      message: error.response?.data || error.message,
    });
  }
};
