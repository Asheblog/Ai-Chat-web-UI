import type { Variants } from 'framer-motion'

export const sidebarVariants: Variants = {
  expanded: {
    width: '16rem',
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
  collapsed: {
    width: '4rem',
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
}

export const sidebarContentVariants: Variants = {
  expanded: {
    opacity: 1,
    transition: {
      delay: 0.1,
      duration: 0.2,
    },
  },
  collapsed: {
    opacity: 0,
    transition: {
      duration: 0.15,
    },
  },
}

export const sessionItemVariants: Variants = {
  initial: {
    opacity: 0,
    x: -10,
  },
  animate: {
    opacity: 1,
    x: 0,
  },
  hover: {
    x: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  exit: {
    opacity: 0,
    x: -10,
  },
}

export const sessionListVariants: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.03,
    },
  },
}
