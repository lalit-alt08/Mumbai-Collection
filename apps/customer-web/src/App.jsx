import { useEffect } from "react";
import axios from "axios";

function App() {
  useEffect(() => {
    const testAddresses = async () => {
      try {
        const response = await axios.get(
          "http://localhost:5000/api/addresses",
          {
            withCredentials: true,
          }
        );

        console.log("✅ ADDRESSES RESPONSE:", response.data);
      } catch (error) {
        console.error(
          "❌ ADDRESS ERROR:",
          error.response?.data || error.message
        );
      }
    };

    testAddresses();
  }, []);

  return (
    <div>
      <h1>Testing Authentication</h1>
      <p>Check the browser console for the address API response.</p>
    </div>
  );
}

export default App;