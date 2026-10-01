import type { Attendee, CalendarEvent, Employee, TripInfo } from "./types";

const maya: Attendee = { name: "Maya Chen", email: "maya.chen@northwind.co" };
const priya: Attendee = { name: "Priya Shah", email: "priya.shah@northwind.co" };
const devon: Attendee = { name: "Devon Brooks", email: "devon.brooks@northwind.co" };
const elena: Attendee = { name: "Elena Voss", email: "elena.voss@acme.com" };
const chris: Attendee = { name: "Chris Dalton", email: "chris.dalton@acme.com" };
const samir: Attendee = { name: "Samir Qureshi", email: "samir.qureshi@acme.com" };
const jordan: Attendee = { name: "Jordan Hale", email: "jordan.hale@brightpath.io" };
const acmeHost: Attendee = { name: "Elena Voss", email: "elena.voss@acme.com" };

export const demoEmployee: Employee = {
  name: "Maya Chen",
  email: "maya.chen@northwind.co",
  company: "Northwind",
};

export const demoTrip: TripInfo = {
  name: "New York",
  city: "New York",
  start: "2026-10-06T08:00:00-04:00",
  end: "2026-10-08T16:40:00-04:00",
};

export function seedEvents(): CalendarEvent[] {
  return [
    {
      id: "standup",
      title: "Team standup",
      description: "Weekly product standup. Internal only.",
      location: "Zoom",
      start: "2026-10-06T08:00:00-04:00",
      end: "2026-10-06T08:25:00-04:00",
      city: "New York",
      attendees: [maya, priya, devon],
    },
    {
      id: "uber-yyz",
      title: "Uber to YYZ",
      description: "Ride to the airport for the New York trip.",
      location: "Waterloo to Toronto Pearson",
      start: "2026-10-06T08:40:00-04:00",
      end: "2026-10-06T09:20:00-04:00",
      city: "Waterloo",
      attendees: [maya],
    },
    {
      id: "flight",
      title: "Flight to LGA",
      description: "Prepaid. Ticket is already booked.",
      location: "Toronto Pearson to LaGuardia",
      start: "2026-10-06T10:15:00-04:00",
      end: "2026-10-06T11:45:00-04:00",
      city: "New York",
      attendees: [maya],
    },
    {
      id: "solo-lunch",
      title: "Solo lunch",
      description: "Lunch in Midtown after landing.",
      location: "Sweetgreen, Midtown",
      start: "2026-10-06T12:45:00-04:00",
      end: "2026-10-06T13:30:00-04:00",
      city: "New York",
      attendees: [maya],
    },
    {
      id: "acme-dinner",
      title: "Dinner with Acme",
      description: "Prospect dinner with the Acme buying group. Discuss the Q4 rollout.",
      location: "Gramercy Tavern, Manhattan",
      start: "2026-10-06T19:00:00-04:00",
      end: "2026-10-06T21:00:00-04:00",
      city: "New York",
      attendees: [maya, elena, chris, samir],
    },
    {
      id: "conference-lunch",
      title: "SaaS conference lunch",
      description: "Meal included in registration.",
      location: "Javits Center, New York",
      start: "2026-10-07T12:00:00-04:00",
      end: "2026-10-07T13:00:00-04:00",
      city: "New York",
      attendees: [maya],
    },
    {
      id: "retro",
      title: "Sprint retro",
      description: "Internal retro. Remote.",
      location: "Zoom",
      start: "2026-10-07T16:30:00-04:00",
      end: "2026-10-07T17:00:00-04:00",
      city: "New York",
      attendees: [maya, priya, devon],
    },
    {
      id: "catch-up",
      title: "Catch up with Jordan",
      description: "Quick catch up while I'm in town.",
      location: "Cafe Integral, Flatiron",
      start: "2026-10-07T18:15:00-04:00",
      end: "2026-10-07T19:00:00-04:00",
      city: "New York",
      attendees: [maya, jordan],
    },
    {
      id: "breakfast",
      title: "Breakfast",
      description: "Breakfast before the onsite.",
      location: "Hotel lobby, Midtown",
      start: "2026-10-08T08:00:00-04:00",
      end: "2026-10-08T08:45:00-04:00",
      city: "New York",
      attendees: [maya],
    },
    {
      id: "workshop",
      title: "Acme workshop",
      description: "Lunch catered by the client.",
      location: "Acme office, Flatiron",
      start: "2026-10-08T10:30:00-04:00",
      end: "2026-10-08T13:00:00-04:00",
      city: "New York",
      attendees: [maya, acmeHost, chris],
    },
    {
      id: "focus",
      title: "Focus block",
      description: "Heads down on the Friday deck.",
      location: "",
      start: "2026-10-08T13:30:00-04:00",
      end: "2026-10-08T15:30:00-04:00",
      city: "New York",
      attendees: [maya],
    },
    {
      id: "uber-lga",
      title: "Uber to LGA",
      description: "Ride to the airport for the flight home.",
      location: "Midtown to LaGuardia",
      start: "2026-10-08T16:00:00-04:00",
      end: "2026-10-08T16:40:00-04:00",
      city: "New York",
      attendees: [maya],
    },
  ];
}
