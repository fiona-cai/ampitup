import type { Attendee, CalendarEvent, Employee, SyncWindow } from "./types";

const maya: Attendee = { name: "Maya Chen", email: "maya.chen@northwind.co" };
const priya: Attendee = { name: "Priya Shah", email: "priya.shah@northwind.co" };
const devon: Attendee = { name: "Devon Brooks", email: "devon.brooks@northwind.co" };
const elena: Attendee = { name: "Elena Voss", email: "elena.voss@acme.com" };
const chris: Attendee = { name: "Chris Dalton", email: "chris.dalton@acme.com" };
const samir: Attendee = { name: "Samir Qureshi", email: "samir.qureshi@acme.com" };
const jordan: Attendee = { name: "Jordan Hale", email: "jordan.hale@brightpath.io" };
const acmeHost: Attendee = { name: "Elena Voss", email: "elena.voss@acme.com" };
const lena: Attendee = { name: "Lena Ortiz", email: "lena.ortiz@lumenhealth.com" };
const omar: Attendee = { name: "Omar Haddad", email: "omar.haddad@northwind.co" };
const sofia: Attendee = { name: "Sofia Lind", email: "sofia.lind@northwind.co" };
const candidate: Attendee = { name: "Ravi Patel", email: "ravi.patel@gmail.com" };

export const demoEmployee: Employee = {
  name: "Maya Chen",
  email: "maya.chen@northwind.co",
  company: "Northwind",
  companyDomain: "northwind.co",
  homeCity: "Waterloo",
};

export function employeeFromGoogle(email: string, name: string): Employee {
  const domain = (process.env.COMPANY_DOMAIN || email.split("@")[1] || "").toLowerCase();
  return {
    name,
    email,
    company: process.env.COMPANY_NAME || domain,
    companyDomain: domain,
    homeCity: process.env.HOME_CITY || demoEmployee.homeCity,
  };
}

export const SEED_WEEK_START = "2026-10-05";

export const demoWindow: SyncWindow = {
  label: "Next 7 days",
  start: "2026-10-05T00:00:00-04:00",
  end: "2026-10-11T23:59:00-04:00",
};

export function seedEvents(): CalendarEvent[] {
  return [
    {
      id: "monday-standup",
      title: "Team standup",
      description: "Weekly product standup. Internal only.",
      location: "Northwind office, Waterloo",
      start: "2026-10-05T09:00:00-04:00",
      end: "2026-10-05T09:25:00-04:00",
      city: "Waterloo",
      attendees: [maya, priya, devon],
    },
    {
      id: "lumen-lunch",
      title: "Lunch with Lumen Health",
      description: "Renewal conversation with their ops lead.",
      location: "Proof Kitchen, Waterloo",
      start: "2026-10-05T12:00:00-04:00",
      end: "2026-10-05T13:00:00-04:00",
      city: "Waterloo",
      attendees: [maya, lena],
    },
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
      description: "Ride to the airport for the Acme visit.",
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
    {
      id: "candidate-coffee",
      title: "Coffee with Ravi (candidate)",
      description: "Informal chat before the onsite loop.",
      location: "Death Valley's Little Brother, Waterloo",
      start: "2026-10-09T10:00:00-04:00",
      end: "2026-10-09T10:45:00-04:00",
      city: "Waterloo",
      attendees: [maya, candidate],
    },
    {
      id: "team-dinner",
      title: "Team dinner",
      description: "Quarter close dinner for the product team.",
      location: "Bauer Kitchen, Waterloo",
      start: "2026-10-09T18:30:00-04:00",
      end: "2026-10-09T20:30:00-04:00",
      city: "Waterloo",
      attendees: [maya, priya, devon, omar, sofia],
    },
  ];
}
