const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso: string | null | undefined): string => (iso ? dateFmt.format(new Date(iso)) : "");
export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? dateTimeFmt.format(new Date(iso)) : "";
