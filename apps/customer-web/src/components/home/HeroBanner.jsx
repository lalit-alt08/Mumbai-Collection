import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, Pagination } from "swiper/modules";

import "swiper/css";
import "swiper/css/pagination";

import { getBanners } from "../../services/productService.js";
import { resolveMediaUrl } from "../../utils/imageUtils.js";

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
          setBanners([]);
        }
      } catch {
        if (isMounted) {
          setBanners([]);
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

  if (loading) {
    return (
      <div className="w-full aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] rounded-[18px] sm:rounded-[22px] bg-[#111F36] border border-[#1E3252]/60 animate-pulse" />
    );
  }

  // If no live banners are configured, do not render static placeholders
  if (banners.length === 0) {
    return null;
  }

  const isMultiSlide = banners.length > 1;

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
      {banners.map((item, index) => {
        const rawDesktop = item.desktop_image || item.mobile_image;
        const rawMobile = item.mobile_image || item.desktop_image;
        const desktopSrc = resolveMediaUrl(rawDesktop);
        const mobileSrc = resolveMediaUrl(rawMobile);
        const hasDistinctImages = Boolean(desktopSrc && mobileSrc && desktopSrc !== mobileSrc);

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
              className="aspect-[16/7] sm:aspect-[16/6] md:max-h-[300px] lg:max-h-[340px] w-full rounded-[18px] sm:rounded-[22px] object-cover"
            />
          </picture>
        ) : (
          <img
            src={desktopSrc || mobileSrc}
            alt={item.title || "Mumbai Collection Promotional Banner"}
            loading={index === 0 ? "eager" : "lazy"}
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
