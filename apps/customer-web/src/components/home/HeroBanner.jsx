import { Link } from "react-router-dom";

import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, Pagination } from "swiper/modules";

import "swiper/css";
import "swiper/css/pagination";

import banner from "../../data/banner";

function HeroBanner() {
  return (
    <Swiper
      modules={[Autoplay, Pagination]}
      autoplay={{
        delay: 5000,
        disableOnInteraction: false,
      }}
      pagination={{
        clickable: true,
      }}
      speed={700}
      loop
      className="overflow-hidden rounded-3xl shadow-sm"
    >
      {banner.map((item) => (
        <SwiperSlide key={item.id}>
          <Link to={item.link}>
            <img
              src={item.image}
              alt=""
              loading="lazy"
              className="w-full rounded-2xl aspect-[16/8] object-cover md:aspect-auto md:object-contain"
            />
          </Link>
        </SwiperSlide>
      ))}
    </Swiper>
  );
}

export default HeroBanner;
