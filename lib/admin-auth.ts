import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";

const ADMIN_EMAILS = new Set(["oncoconnect2@gmail.com"]);

export async function getAdminUser(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  return user && ADMIN_EMAILS.has(user.email.toLowerCase()) ? user : null;
}
