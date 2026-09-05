import type { AuthUser } from "@aichat/shared/api-contract";

// 移动端用户视图与 shared AuthUser 保持一致（额外字段为可选，不影响消费）。
export type MobileUser = AuthUser;

export type AuthSession = {
  token: string;
  user: MobileUser;
};

export type RegisterResult =
  | { kind: "signed-in"; session: AuthSession; message?: string }
  | { kind: "pending"; user: MobileUser; message?: string };
