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
  const [loadingMore, setLoadingMore] = useState(false);
  const [favoritePage, setFavoritePage] = useState(0);
  const [favoriteTotalPages, setFavoriteTotalPages] = useState(0);
  const [favoriteTotal, setFavoriteTotal] = useState(0);

  // Fast lightweight ID sync across all pages (zero catalog product loading)
  const fetchFavorites = useCallback(async () => {
    if (!user) {
      setFavoriteIds(new Set());
      setFavorites([]);
      setFavoritePage(0);
      setFavoriteTotalPages(0);
      setFavoriteTotal(0);
      return;
    }

    try {
      const res = await getFavoriteIds();
      if (res?.success) {
        const ids = new Set((res.productIds || []).map(Number));
        setFavoriteIds(ids);
        setFavoriteTotal(Number(res.count) || ids.size);
      }
    } catch {
      // Failed to load customer favorite IDs
    }
  }, [user]);

  // Full catalog details fetch (strictly called when customer opens /favorites page)
  const loadFullFavorites = useCallback(async ({ page = 1, append = false } = {}) => {
    if (!user) {
      setFavorites([]);
      setFavoritePage(0);
      setFavoriteTotalPages(0);
      setFavoriteTotal(0);
      return [];
    }

    try {
      if (append) setLoadingMore(true);
      else setLoading(true);
      const res = await getFavorites({ page, perPage: 24 });
      if (res?.success) {
        const ids = new Set((res.productIds || []).map(Number));
        const nextFavorites = res.favorites || [];
        setFavoriteIds(ids);
        setFavorites((current) => {
          if (!append) return nextFavorites;
          const byId = new Map(current.map((product) => [Number(product.id), product]));
          nextFavorites.forEach((product) => byId.set(Number(product.id), product));
          return [...byId.values()];
        });
        setFavoritePage(Number(res.page) || page);
        setFavoriteTotalPages(Number(res.totalPages) || 0);
        setFavoriteTotal(Number(res.total) || ids.size);
        return nextFavorites;
      }
    } catch {
      // Failed to load full customer favorites
    } finally {
      setLoading(false);
      setLoadingMore(false);
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

  const updateLoadedFavorites = useCallback((updater) => {
    setFavorites(updater);
  }, []);

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
    setFavoriteTotal((current) => Math.max(0, current + (currentlyFavorited ? -1 : 1)));

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

      // A mutation changes every later offset in the paginated wishlist. When
      // the customer is viewing that page, reload page one from the canonical
      // server order so a subsequently loaded page cannot skip or duplicate an
      // item that shifted across a page boundary.
      if (typeof window !== "undefined" && window.location.pathname === "/favorites") {
        await loadFullFavorites({ page: 1, append: false });
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
      setFavoriteTotal((current) => Math.max(0, current + (currentlyFavorited ? 1 : -1)));
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
        loadingMore,
        favoritePage,
        favoriteTotalPages,
        favoriteTotal,
        updateLoadedFavorites,
        isFavorited,
        toggleFavorite,
        loadFullFavorites,
        loadMoreFavorites: () => loadFullFavorites({ page: favoritePage + 1, append: true }),
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
