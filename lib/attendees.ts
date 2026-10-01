import { policy } from "./policy";
import type { Attendee, CalendarEvent } from "./types";

export function isExternal(email: string, domain = policy.companyDomain): boolean {
  const host = email.split("@")[1]?.toLowerCase() ?? "";
  return host.length > 0 && host !== domain.toLowerCase();
}

export function externalAttendees(event: CalendarEvent, domain = policy.companyDomain): Attendee[] {
  return event.attendees.filter((attendee) => isExternal(attendee.email, domain));
}

export function peopleLine(event: CalendarEvent, selfEmail: string, domain = policy.companyDomain): string {
  const others = event.attendees.filter((attendee) => attendee.email.toLowerCase() !== selfEmail.toLowerCase());
  if (others.length === 0) return "Just you";
  const external = others.filter((attendee) => isExternal(attendee.email, domain));
  const shown = external.length > 0 ? external : others;
  return shown.map((attendee) => attendee.name.split(" ")[0]).join(", ");
}
