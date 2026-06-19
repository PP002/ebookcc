import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import slides from '../slide-config.json';

export const Slideshow: React.FC = () => {
  const [index, setIndex] = useState(0);

  const getSlideStyle = (slideIndex: number) => {
    let diff = slideIndex - index;
    // Circular difference
    if (diff > slides.length / 2) diff -= slides.length;
    if (diff < -slides.length / 2) diff += slides.length;

    if (diff === 0) return { opacity: 1, scale: 1, filter: 'blur(0px)', x: '0%', zIndex: 10 };
    if (diff === 1) return { opacity: 0.6, scale: 0.8, filter: 'blur(4px)', x: '100%', zIndex: 1 };
    return { opacity: 0.6, scale: 0.8, filter: 'blur(4px)', x: '-100%', zIndex: 1 };
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 w-full">
      <div className="relative w-[75%] md:w-[33%] aspect-video mx-auto overflow-hidden rounded-xl">
        {slides.map((slide, i) => (
          <motion.div
            key={slide.img}
            initial={getSlideStyle(i)}
            animate={getSlideStyle(i)}
            transition={{ duration: 0.5 }}
            className="absolute w-[66%] md:w-[60%] p-2 left-[17%] md:left-[20%]"
          >
            <img
              src={slide.img}
              alt={slide.alt}
              className={`w-full h-full object-contain ${slide.needsOutline ? 'border border-primary' : ''}`}
            />
          </motion.div>
        ))}
      </div>
      <p className="text-xl font-normal text-foreground px-4 py-1.5 rounded-full inline-block shadow-sm">
        {slides[index].name}
      </p>
    </div>
  );
};
