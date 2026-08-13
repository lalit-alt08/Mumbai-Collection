import axios from "axios";
import https from "https";

const httpsAgent =
  process.env.NODE_ENV === "development"
    ? new https.Agent({
        rejectUnauthorized: false,
      })
    : undefined;

const wp = axios.create({
  baseURL: process.env.WORDPRESS_URL,

  auth: {
    username: process.env.WP_USERNAME,
    password: process.env.WP_APPLICATION_PASSWORD,
  },

  httpsAgent,
});

export default wp;