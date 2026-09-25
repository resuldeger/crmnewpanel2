
export enum FormStep {
  WELCOME = 0,
  PURPOSE = 1,
  STYLE = 2,
  STORY = 3,
  BODY_AREA = 4,
  SIZE = 5,
  TIMING = 6,
  CONTACT = 7,
  ADDRESS = 9,
  SUCCESS = 8
}

export type TattooStyle = 'Realism' | 'Black & grey' | 'Color' | 'Minimal' | 'Fine line' | 'Japanese' | 'Lettering';

export interface FormData {
  purpose: string;
  style: TattooStyle | '';
  storyType: string;
  storyDescription: string;
  referenceImage?: string;
  bodyArea: string[];
  size: string;
  timing: string;
  selectedDate: string;
  selectedTime: string;
  fullName: string;
  email: string;
  phone: string;
  smsConsent: boolean;
  timezone: string;
  // Free Pick fields
  isFreePick: boolean;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  turnstileToken?: string;
}

export const INITIAL_FORM_DATA: FormData = {
  purpose: '',
  style: '',
  storyType: '',
  storyDescription: '',
  referenceImage: '',
  bodyArea: [],
  size: '',
  timing: '',
  selectedDate: '',
  selectedTime: '',
  fullName: '',
  email: '',
  phone: '',
  smsConsent: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  isFreePick: false,
  addressStreet: '',
  addressCity: '',
  addressState: '',
  addressZip: '',
};

