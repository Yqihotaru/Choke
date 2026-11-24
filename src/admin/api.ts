import type { MailAttachment, MailAudience, MailKind } from "@choke/shared/mail"

import { request } from "@/desk/session/api"

export interface AdminUserRow {
  id: string
  username: string
  publicId: number
  level: number
}

export interface AdminBatch {
  id: number
  adminId: string
  audience: MailAudience
  recipientCount: number
  kind: MailKind
  title: string
  body: string
  attachment: MailAttachment | null
  createdAt: string
}

export interface AdminMailPayload {
  audience: MailAudience
  kind: MailKind
  title: string
  body: string
  attachment: MailAttachment | null
  confirmCount?: number
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export function searchUsers(q: string): Promise<{ users: AdminUserRow[] }> {
  return request(`/api/admin/users?q=${encodeURIComponent(q)}`)
}

export function previewAudience(
  audience: MailAudience,
): Promise<{ recipients: number; sample: { id: string; username: string }[] }> {
  return request("/api/admin/mails/preview", json({ audience }))
}

export function sendAdminMail(payload: AdminMailPayload): Promise<{ batchId: number; recipients: number }> {
  return request("/api/admin/mails", json(payload))
}

export function fetchBatches(): Promise<{ batches: AdminBatch[] }> {
  return request("/api/admin/mail-batches")
}
