import type { Variants, Transition } from 'framer-motion'

export const welcomeScreenVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -20,
  },
}

export const chatInterfaceVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.98,
    y: 30,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: -30,
  },
}

export const pageTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8,
}

export const fadeTransition: Transition = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1],
}

export const fadeInVariants: Variants = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
  },
  exit: {
    opacity: 0,
  },
}

export const slideInFromTopVariants: Variants = {
  initial: {
    y: -20,
    opacity: 0,
  },
  animate: {
    y: 0,
    opacity: 1,
  },
  exit: {
    y: -20,
    opacity: 0,
  },
}

export const slideInFromBottomVariants: Variants = {
  initial: {
    y: 20,
    opacity: 0,
  },
  animate: {
    y: 0,
    opacity: 1,
  },
  exit: {
    y: 20,
    opacity: 0,
  },
}

export const scaleVariants: Variants = {
  initial: {
    scale: 0.9,
    opacity: 0,
  },
  animate: {
    scale: 1,
    opacity: 1,
  },
  exit: {
    scale: 0.9,
    opacity: 0,
  },
}

export const springTransition: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 20,
}

export const smoothTransition: Transition = {
  duration: 0.4,
  ease: [0.4, 0, 0.2, 1],
}

export const createDelayedVariants = (delay: number): Variants => ({
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      delay,
      duration: 0.3,
    },
  },
})

export const createStaggerContainer = (staggerDelay: number = 0.05): Variants => ({
  animate: {
    transition: {
      staggerChildren: staggerDelay,
    },
  },
})
