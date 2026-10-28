import type { BloodType, HealthLang, ProfileInput, Relation, Sex } from '../../services/health/health.types';
import { checkDate } from '../../services/health/selectors';

export const BLOOD_TYPES: readonly BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const FAMILY_RELATIONS: readonly Relation[] = ['child', 'parent', 'spouse', 'other'];
export const SEXES: readonly Sex[] = ['female', 'male'];

/** The blood type chips' "Unknown", as a chip value. */
export const UNKNOWN = 'unknown';

export const profileCopy = {
  en: {
    editTitle: 'Profile details',
    addTitle: 'Add family member',
    subtitle: 'Basic details doctors ask for first.',
    name: 'Name',
    relation: 'Relationship',
    sex: 'Sex',
    dateOfBirth: 'Date of birth',
    bloodType: 'Blood type',
    bloodTypeHint: 'Optional, but useful in an emergency. Choose Unknown if you’re not sure.',
    save: 'Save details',
    add: 'Add family member',
    errors: {
      name: 'Enter a name.',
      dateFormat: 'Choose a valid date.',
      dateFuture: 'The date of birth can’t be in the future.',
    },
  },
  ar: {
    editTitle: 'بيانات الملف',
    addTitle: 'إضافة فرد من العائلة',
    subtitle: 'البيانات الأساسية التي يسأل عنها الطبيب أولًا.',
    name: 'الاسم',
    relation: 'صلة القرابة',
    sex: 'الجنس',
    dateOfBirth: 'تاريخ الميلاد',
    bloodType: 'فصيلة الدم',
    bloodTypeHint: 'اختيارية، لكنها مفيدة في الطوارئ. اختر «غير معروفة» إن لم تكن متأكدًا.',
    save: 'حفظ البيانات',
    add: 'إضافة فرد من العائلة',
    errors: {
      name: 'أدخل الاسم.',
      dateFormat: 'اختر تاريخًا صحيحًا.',
      dateFuture: 'لا يمكن أن يكون تاريخ الميلاد في المستقبل.',
    },
  },
} satisfies Record<HealthLang, unknown>;

export type ProfileErrors = Partial<Record<'name' | 'date_of_birth', string>>;

export function validateProfile(input: ProfileInput, lang: HealthLang): ProfileErrors {
  const copy = profileCopy[lang].errors;
  const errors: ProfileErrors = {};
  if (!input.name.trim()) errors.name = copy.name;
  const date = checkDate(input.date_of_birth ?? '');
  if (date === 'format') errors.date_of_birth = copy.dateFormat;
  if (date === 'future') errors.date_of_birth = copy.dateFuture;
  return errors;
}
