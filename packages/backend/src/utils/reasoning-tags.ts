// UTF-8，无 BOM
// 轻量级推理标签抽取器：将 content 中的思维链片段剥离到 reasoning，返回可见正文与推理增量。
// 兼容 Linux/Windows 环境，无特殊依赖。

export type TagPair = [string, string];

export interface ReasoningExtractState {
  inTag: boolean;
  endTag: string | null;
  // 是否曾经进入过推理段，用于计算持续时间
  startedAt: number | null;
}

export interface ExtractResult {
  visibleDelta: string;
  reasoningDelta: string;
  started: boolean; // 本次调用是否开始了推理段
  ended: boolean; // 本次调用是否结束了推理段
}

export const DEFAULT_REASONING_TAGS: TagPair[] = [
  ['<think>', '</think>'],
  ['<thinking>', '</thinking>'],
  ['<reason>', '</reason>'],
  ['<reasoning>', '</reasoning>'],
  ['<thought>', '</thought>'],
  ['<Thought>', '</Thought>'],
  ['<|begin_of_thought|>', '<|end_of_thought|>'],
  ['◁think▷', '◁/think▷'],
];

export function createReasoningState(): ReasoningExtractState {
  return { inTag: false, endTag: null, startedAt: null };
}

export function extractByTags(
  chunk: string,
  tags: TagPair[],
  state: ReasoningExtractState
): ExtractResult {
  let i = 0;
  let visibleDelta = '';
  let reasoningDelta = '';
  let started = false;
  let ended = false;

  while (i < chunk.length) {
    if (!state.inTag) {
      // 查找最近的开始标签
      let nextPos = -1;
      let chosen: TagPair | null = null;
      for (const pair of tags) {
        const pos = chunk.indexOf(pair[0], i);
        if (pos !== -1 && (nextPos === -1 || pos < nextPos)) {
          nextPos = pos;
          chosen = pair;
        }
      }
      if (nextPos === -1 || !chosen) {
        // 无标签，剩余全部为可见内容
        visibleDelta += chunk.slice(i);
        break;
      }
      // 追加开始标签之前的可见内容
      visibleDelta += chunk.slice(i, nextPos);
      // 进入标签态
      state.inTag = true;
      state.endTag = chosen[1];
      if (!state.startedAt) {
        state.startedAt = Date.now();
        started = true;
      }
      i = nextPos + chosen[0].length;
    } else {
      // 寻找结束标签
      const end = state.endTag!;
      const pos = chunk.indexOf(end, i);
      if (pos === -1) {
        // 整个余量都在推理块内
        reasoningDelta += chunk.slice(i);
        break;
      }
      // 结束标签之前为推理内容
      reasoningDelta += chunk.slice(i, pos);
      // 退出标签态
      state.inTag = false;
      state.endTag = null;
      ended = true;
      i = pos + end.length;
    }
  }

  return { visibleDelta, reasoningDelta, started, ended };
}

