import axios from "axios";

const wp = axios.create({
  baseURL: process.env.WORDPRESS_URL,
  auth: {
    username: process.env.WP_USERNAME,
    password: process.env.WP_APPLICATION_PASSWORD,
  },
});

export default wp;