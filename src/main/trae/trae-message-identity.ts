const USER_MESSAGE_ID =
  /^msg_([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** TRAE's root user UUIDv7 records the provider's receipt time. */
export function traeUserMessageTimestamp(messageId: string): number | null {
  const match = USER_MESSAGE_ID.exec(messageId)
  return match ? Number.parseInt(`${match[1]}${match[2]}`, 16) : null
}

/** Older imports prefixed root users with segment and turn IDs. */
export function traeImportedUserMessageId(recordId: string): string | null {
  const parts = recordId.split(':')
  const id = parts.at(-1) ?? ''
  return (parts.length === 1 || parts.length === 3) && USER_MESSAGE_ID.test(id) ? id : null
}
