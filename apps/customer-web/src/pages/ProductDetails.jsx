import { useParams } from "react-router-dom";

function ProductDetails() {
  const { id } = useParams();

  return (
    <div>
      Product ID : {id}
    </div>
  );
}

export default ProductDetails;