import type { Variants, Transition } from 'framer-motion'

export const messageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: {
      duration: 0.2,
    },
  },
}

export const messageListVariants: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

export const messageTransition: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 25,
}

export const inputFocusVariants: Variants = {
  unfocused: {
    scale: 1,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  },
  focused: {
    scale: 1.01,
    boxShadow:
      '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  },
}

export const sendButtonVariants: Variants = {
  idle: {
    scale: 1,
  },
  hover: {
    scale: 1.05,
  },
  tap: {
    scale: 0.95,
  },
  sending: {
    scale: [1, 0.9, 1],
    transition: {
      duration: 0.3,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}

export const dropdownVariants: Variants = {
  closed: {
    opacity: 0,
    scale: 0.95,
    y: -10,
  },
  open: {
    opacity: 1,
    scale: 1,
    y: 0,
  },
}

export const imageUploadVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.8,
  },
  animate: {
    opacity: 1,
    scale: 1,
  },
  hover: {
    scale: 1.05,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  },
  exit: {
    opacity: 0,
    scale: 0.8,
  },
}

export const shimmerVariants: Variants = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'linear',
    },
  },
}

export const pulseVariants: Variants = {
  animate: {
    opacity: [0.5, 1, 0.5],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}
