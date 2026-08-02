function calculateSubtotal(cart) {
  return cart.reduce((total, item) => {
    return total + Number(item.price) * item.quantity;
  }, 0);
}

export default calculateSubtotal;