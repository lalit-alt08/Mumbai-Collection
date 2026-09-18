import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, Pagination } from "swiper/modules";

import "swiper/css";
import "swiper/css/pagination";

import staticBanners from "../../data/banner.js";
import { getBanners } from "../../services/productService.js";
import { resolveMediaUrl } from "../../utils/imageUtils.js";

// Normalize static fallback banners
const FALLBACK_BANNERS = staticBanners.map((item, idx) => ({
  id: item.id || `static-${idx + 1}`,
  title: item.title || `Featured Collection #${idx + 1}`,
  link: item.link || "/categories",
  desktop_image: item.image || "/banner/Art.webp",
  mobile_image: item.image || "/banner/Art.webp",
  is_active: true,
}));

function HeroBanner() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadLiveBanners = async () => {
      try {
        const res = await getBanners();
        if (!isMounted) return;

        const liveList = res?.banners || (Array.isArray(res) ? res : []);
        const activeList = liveList.filter(
          (b) => b && b.is_active !== false && (b.desktop_image || b.mobile_image)
        );

        if (activeList.length > 0) {
          setBanners(activeList.slice(0, 3));
        } else {
          setBanners(FALLBACK_BANNERS);
        }
      } catch {
        if (isMounted) {
          setBanners(FALLBACK_BANNERS);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadLiveBanners();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading && banners.length === 0) {
    return (
      <div className="w-full aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] rounded-[18px] sm:rounded-[22px] bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
    );
  }

  const displayBanners = banners.length > 0 ? banners.slice(0, 3) : FALLBACK_BANNERS;
  const isMultiSlide = displayBanners.length > 1;

  return (
    <Swiper
      modules={isMultiSlide ? [Autoplay, Pagination] : []}
      autoplay={
        isMultiSlide
          ? {
              delay: 5000,
              disableOnInteraction: false,
            }
          : false
      }
      pagination={
        isMultiSlide
          ? {
              clickable: true,
            }
          : false
      }
      speed={700}
      loop={isMultiSlide}
      className="overflow-hidden rounded-[18px] sm:rounded-[22px] shadow-xs md:shadow-sm"
    >
      {displayBanners.map((item, index) => {
        const rawDesktop = item.desktop_image || item.mobile_image;
        const rawMobile = item.mobile_image || item.desktop_image;
        const desktopSrc = resolveMediaUrl(rawDesktop);
        const mobileSrc = resolveMediaUrl(rawMobile);
        const hasDistinctImages = Boolean(desktopSrc && mobileSrc && desktopSrc !== mobileSrc);
        const fallbackSrc =
          FALLBACK_BANNERS[index % FALLBACK_BANNERS.length]?.desktop_image ||
          "/banner/Art.webp";

        const handleImageError = (e) => {
          if (e.currentTarget.getAttribute("data-fallback") !== "true") {
            e.currentTarget.setAttribute("data-fallback", "true");
            const picture = e.currentTarget.closest("picture");
            if (picture) {
              const sources = picture.querySelectorAll("source");
              sources.forEach((s) => s.removeAttribute("srcset"));
            }
            e.currentTarget.src = fallbackSrc;
          }
        };

        const BannerImage = hasDistinctImages ? (
          <picture className="block w-full">
            {/* Mobile Viewport (< 640px) */}
            <source media="(max-width: 639px)" srcSet={mobileSrc} />
            {/* Desktop / Tablet Viewport (>= 640px) */}
            <source media="(min-width: 640px)" srcSet={desktopSrc} />
            <img
              src={desktopSrc}
              alt={item.title || "Mumbai Collection Promotional Banner"}
              loading={index === 0 ? "eager" : "lazy"}
              onError={handleImageError}
              className="aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] w-full rounded-[18px] sm:rounded-[22px] object-cover"
            />
          </picture>
        ) : (
          <img
            src={desktopSrc || mobileSrc}
            alt={item.title || "Mumbai Collection Promotional Banner"}
            loading={index === 0 ? "eager" : "lazy"}
            onError={handleImageError}
            className="aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] w-full rounded-[18px] sm:rounded-[22px] object-cover"
          />
        );

        return (
          <SwiperSlide key={item.id || index}>
            {item.link ? (
              <Link to={item.link} className="block w-full cursor-pointer focus:outline-none">
                {BannerImage}
              </Link>
            ) : (
              <div className="block w-full">{BannerImage}</div>
            )}
          </SwiperSlide>
        );
      })}
    </Swiper>
  );
}

export default HeroBanner;
