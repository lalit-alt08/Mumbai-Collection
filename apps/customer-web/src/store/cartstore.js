import { create } from "zustand";

const useCartStore = create((set, get) => ({
  cart: [],

  addToCart: (product) => {
    console.log("Before:", get().cart);

    set((state) => ({
      cart: [...state.cart, product],
    }));

    console.log("After:", get().cart);
  },
}));

export default useCartStore;