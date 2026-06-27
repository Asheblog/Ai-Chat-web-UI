export type MobileUser = {
  id: number;
  username: string;
  role: "ADMIN" | "USER";
  status: "PENDING" | "ACTIVE" | "DISABLED";
  avatarUrl?: string | null;
};

export type AuthSession = {
  token: string;
  user: MobileUser;
};

export type RegisterResult =
  | { kind: "signed-in"; session: AuthSession; message?: string }
  | { kind: "pending"; user: MobileUser; message?: string };
