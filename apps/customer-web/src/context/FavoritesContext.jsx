import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  getFavoriteIds,
  getFavorites,
  addFavorite as addFavApi,
  removeFavorite as removeFavApi,
} from "../services/favoritesService";

const FavoritesContext = createContext(null);

export const FavoritesProvider = ({ children }) => {
  const { user } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fast lightweight ID sync across all pages (zero catalog product loading)
  const fetchFavorites = useCallback(async () => {
    if (!user) {
      setFavoriteIds(new Set());
      setFavorites([]);
      return;
    }

    try {
      const res = await getFavoriteIds();
      if (res?.success) {
        const ids = new Set((res.productIds || []).map(Number));
        setFavoriteIds(ids);
      }
    } catch {
      // Failed to load customer favorite IDs
    }
  }, [user]);

  // Full catalog details fetch (strictly called when customer opens /favorites page)
  const loadFullFavorites = useCallback(async () => {
    if (!user) {
      setFavorites([]);
      return [];
    }

    try {
      setLoading(true);
      const res = await getFavorites();
      if (res?.success) {
        const ids = new Set((res.productIds || []).map(Number));
        setFavoriteIds(ids);
        setFavorites(res.favorites || []);
        return res.favorites || [];
      }
    } catch {
      // Failed to load full customer favorites
    } finally {
      setLoading(false);
    }
    return [];
  }, [user]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const isFavorited = useCallback(
    (productId) => {
      return favoriteIds.has(Number(productId));
    },
    [favoriteIds]
  );

  const toggleFavorite = async (product) => {
    if (!user) {
      // Return false indicating customer should log in
      return { requiresAuth: true };
    }

    const productId = Number(product.id || product);
    const currentlyFavorited = favoriteIds.has(productId);

    // Optimistic UI Update
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (currentlyFavorited) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });

    if (currentlyFavorited) {
      setFavorites((prev) => prev.filter((p) => Number(p.id) !== productId));
    } else if (typeof product === "object" && product.id) {
      setFavorites((prev) => [product, ...prev]);
    }

    try {
      if (currentlyFavorited) {
        await removeFavApi(productId);
      } else {
        await addFavApi(productId);
      }
      return { success: true, isFavorited: !currentlyFavorited };
    } catch (err) {
      // Rollback on error
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (currentlyFavorited) {
          next.add(productId);
        } else {
          next.delete(productId);
        }
        return next;
      });
      if (currentlyFavorited) {
        if (typeof product === "object" && product.id) {
          setFavorites((prev) => [product, ...prev]);
        }
      } else {
        setFavorites((prev) => prev.filter((p) => Number(p.id) !== productId));
      }
      return { success: false, error: err?.message || "Failed to update wishlist" };
    }
  };

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        favoriteIds,
        loading,
        isFavorited,
        toggleFavorite,
        loadFullFavorites,
        refreshFavorites: fetchFavorites,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites must be used within a FavoritesProvider");
  }
  return context;
};

export default FavoritesContext;
