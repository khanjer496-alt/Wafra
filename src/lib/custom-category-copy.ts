export const customCategoryCopy = {
  en: {
    newCategory: 'New category', name: 'Category name', create: 'Create category', cancel: 'Cancel',
    hint: 'Choose a name with up to 40 characters.',
    errors: { 'invalid-name': 'Enter a name with 1–40 characters.', 'duplicate-name': 'A category with this name already exists.',
      limit: 'You can create up to 100 custom categories.', 'not-ready': 'Your data is still loading. Try again in a moment.' },
  },
  ar: {
    newCategory: 'فئة جديدة', name: 'اسم الفئة', create: 'إنشاء الفئة', cancel: 'إلغاء',
    hint: 'اختر اسماً لا يزيد عن 40 حرفاً.',
    errors: { 'invalid-name': 'أدخل اسماً من حرف واحد إلى 40 حرفاً.', 'duplicate-name': 'توجد فئة بهذا الاسم بالفعل.',
      limit: 'يمكنك إنشاء ما يصل إلى 100 فئة مخصصة.', 'not-ready': 'لا تزال بياناتك قيد التحميل. حاول مرة أخرى بعد قليل.' },
  },
} as const;
