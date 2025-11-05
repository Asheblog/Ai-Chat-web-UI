import { Variants, Transition } from 'framer-motion';

/**
 * 全局动画配置
 * 基于 framer-motion 实现流畅现代的动画效果
 */

// ==================== 页面切换动画 ====================

/**
 * 欢迎屏幕的动画变体
 */
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
};

/**
 * 聊天界面的动画变体
 */
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
};

/**
 * 页面切换的过渡配置（带弹性效果）
 */
export const pageTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

/**
 * 快速淡入淡出过渡
 */
export const fadeTransition: Transition = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1], // easeInOut cubic-bezier
};

// ==================== 消息列表动画 ====================

/**
 * 单条消息的动画变体
 */
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
};

/**
 * 消息列表容器的动画变体（支持 stagger 效果）
 */
export const messageListVariants: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.05, // 每条消息间隔 50ms
    },
  },
};

/**
 * 消息过渡配置
 */
export const messageTransition: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 25,
};

// ==================== 输入框动画 ====================

/**
 * 输入框聚焦时的动画
 */
export const inputFocusVariants: Variants = {
  unfocused: {
    scale: 1,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  },
  focused: {
    scale: 1.01,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  },
};

/**
 * 发送按钮的动画
 */
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
};

/**
 * 模型选择器下拉动画
 */
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
};

/**
 * 图片上传缩略图动画
 */
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
};

// ==================== 侧边栏动画 ====================

/**
 * 侧边栏展开/收起动画
 */
export const sidebarVariants: Variants = {
  expanded: {
    width: '16rem', // w-64
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
  collapsed: {
    width: '4rem', // w-16
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
};

/**
 * 侧边栏内容淡入淡出
 */
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
};

/**
 * 会话列表项的动画
 */
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
};

/**
 * 会话列表容器动画（支持 stagger）
 */
export const sessionListVariants: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.03,
    },
  },
};

// ==================== 骨架屏动画 ====================

/**
 * 骨架屏 shimmer 动画
 */
export const shimmerVariants: Variants = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

/**
 * 骨架屏脉冲动画
 */
export const pulseVariants: Variants = {
  animate: {
    opacity: [0.5, 1, 0.5],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// ==================== 通用动画效果 ====================

/**
 * 淡入动画
 */
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
};

/**
 * 从上方滑入
 */
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
};

/**
 * 从下方滑入
 */
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
};

/**
 * 缩放动画
 */
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
};

/**
 * 弹性过渡配置
 */
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 20,
};

/**
 * 平滑过渡配置
 */
export const smoothTransition: Transition = {
  duration: 0.4,
  ease: [0.4, 0, 0.2, 1],
};

// ==================== 工具函数 ====================

/**
 * 创建延迟动画
 */
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
});

/**
 * 创建 stagger 容器动画
 */
export const createStaggerContainer = (staggerDelay: number = 0.05): Variants => ({
  animate: {
    transition: {
      staggerChildren: staggerDelay,
    },
  },
});
