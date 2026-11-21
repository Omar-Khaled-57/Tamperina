import type { Message } from '../i18n'

/** Bulk attendance, bulk export, bulk removal and bulk evaluation. */
export const bulkMessages = {
  // ---- Parsing -------------------------------------------------------------
  'data.parse.noValues': { ar: 'لا توجد قيم', en: 'No values' },
  'data.parse.tooManyFields': { ar: 'حقول كثيرة', en: 'Too many fields' },
  'data.parse.unknownValue': { ar: 'قيمة غير مفهومة', en: 'Unrecognized value' },
  'data.parse.twoHomeworkGrades': { ar: 'درجتا واجب بدون درجة امتحان', en: 'Two homework grades without an exam grade' },

  // ---- Shared --------------------------------------------------------------
  'data.noCode': { ar: 'بدون كود', en: 'No code' },
  'data.student': { ar: 'طالب', en: 'Student' },

  // ---- Attendance: search --------------------------------------------------
  'data.search.noUrl': { ar: 'رابط البحث عن الطلاب غير متاح في الصفحة.', en: 'Student search URL is not available on the page.' },
  'data.search.failed': { ar: 'تعذر البحث ({{p0}})', en: 'Search failed ({{p0}})' },
  'data.search.unexpected': { ar: 'استجابة بحث غير متوقعة.', en: 'Unexpected search response.' },
  'data.search.connectionFailed': { ar: 'تعذر الاتصال أثناء البحث.', en: 'Connection failed while searching.' },

  // ---- Attendance: name resolution -----------------------------------------
  'data.name.empty': { ar: 'الاسم فارغ.', en: 'Name is empty.' },
  'data.name.tooMany': { ar: 'نتائج كثيرة جدًا — حدّد الاسم أكثر أو استخدم الكود.', en: 'Too many results — narrow down the name or use the code.' },
  'data.name.notFound': { ar: 'لم يتم العثور على طالب مطابق.', en: 'No matching student was found.' },
  'data.name.identified': { ar: 'تم التعرف: {{p0}} ({{p1}})', en: 'Recognized: {{p0}} ({{p1}})' },
  'data.name.singleMatch': { ar: 'مطابقة واحدة: {{p0}} ({{p1}})', en: 'Single match: {{p0}} ({{p1}})' },
  'data.name.autoSelected': { ar: 'تم الاختيار تلقائيًا: {{p0}} ({{p1}})', en: 'Automatically selected: {{p0}} ({{p1}})' },
  'data.name.multipleMatches': { ar: 'يوجد أكثر من طالب مطابق — اختر الصحيح.', en: 'More than one matching student — choose the right one.' },
  'data.name.uncertainMatch': { ar: 'تعذّر التأكد من المطابقة.', en: 'Could not confirm the match.' },

  // ---- Attendance: payment labels ------------------------------------------
  'data.payment.paid': { ar: 'كامل', en: 'Paid' },
  'data.payment.partial': { ar: 'جزئي', en: 'Partial' },
  'data.payment.discounted': { ar: 'مخفض', en: 'Discounted' },
  'data.payment.forgotten': { ar: 'نسي/مؤجل', en: 'Forgotten/deferred' },
  'data.payment.default': { ar: 'افتراضي الحصة', en: 'Lesson default' },

  // ---- Attendance: run / row messages --------------------------------------
  'data.school.csrfMissing': { ar: 'تعذّر قراءة CSRF token من الصفحة.', en: 'Could not read the CSRF token from the page.' },
  'data.school.connectionFailed': { ar: 'تعذّر الاتصال بالخادم.', en: 'Could not connect to the server.' },
  'data.school.lessonUnknown': { ar: 'رقم الحصة غير معروف.', en: 'Lesson number is unknown.' },
  'data.run.registered': { ar: 'تم التسجيل', en: 'Registered' },
  'data.run.registeredWithPayment': { ar: 'تم التسجيل — {{p0}}', en: 'Registered — {{p0}}' },
  'data.run.registeredFromResponse': { ar: 'تم التسجيل — {{p0}} (تأكيد من الاستجابة)', en: 'Registered — {{p0}} (confirmed from response)' },
  'data.run.alreadyRegistered': { ar: 'مسجّل بالفعل', en: 'Already registered' },
  'data.run.duplicateInList': { ar: 'مكرر في القائمة — لم يُرسل مرتين', en: 'Duplicate in the list — not sent twice' },
  'data.run.submittedNoUndo': { ar: 'تم الإرسال لكن لم يصل تأكيد قابل للتراجع — راجع السجل يدويًا', en: 'Submitted but no undoable confirmation arrived — check the log manually' },
  'data.run.unexpectedServerResponse': { ar: 'استجابة غير متوقعة من الخادم', en: 'Unexpected response from the server' },
  'data.run.submitException': { ar: 'استثناء أثناء الإرسال: {{p0}}', en: 'Exception while submitting: {{p0}}' },
  'data.run.workerCrashed': { ar: 'توقف عامل إرسال: {{p0}}', en: 'A submit worker stopped: {{p0}}' },
  'data.center.formNotFound': { ar: 'تعذّر العثور على نموذج/حقل الإدخال', en: 'Could not find the form/input field' },
  'data.center.noConfirmation': { ar: 'لم يصل تأكيد من الخادم', en: 'No confirmation was received from the server' },
  'data.center.unexpectedResponse': { ar: 'استجابة غير متوقعة', en: 'Unexpected response' },

  // ---- Evaluation: matching ------------------------------------------------
  'data.eval.nameAmbiguous': { ar: 'الاسم مطابق لأكثر من طالب — اختر الصحيح', en: 'Name matches more than one student — choose the right one' },
  'data.eval.nameSimilar': { ar: 'وُجد أكثر من طالب مشابه — اختر الصحيح', en: 'More than one similar student found — choose the right one' },
  'data.eval.tooMany': { ar: 'نتائج كثيرة جدًا — حدّد الاسم أكثر', en: 'Too many results — narrow down the name' },
  'data.eval.codeNotFound': { ar: 'لم يُعثر على هذا الكود في صفحة التقييم الحالية', en: 'This code was not found on the current evaluation page' },
  'data.eval.studentNotFound': { ar: 'لم يُعثر على الطالب في صفحة التقييم الحالية', en: 'The student was not found on the current evaluation page' },

  // ---- Evaluation: applying values -----------------------------------------
  'data.eval.missingExamGrade': { ar: 'درجة الامتحان', en: 'Exam grade' },
  'data.eval.missingHomeworkGrade': { ar: 'درجة الواجب', en: 'Homework grade' },
  'data.eval.homeworkOptionMissing': { ar: 'خيار الواجب «{{p0}}»', en: 'Homework option «{{p0}}»' },
  'data.eval.notFoundList': { ar: 'لم يُعثر على: {{p0}}', en: 'Not found: {{p0}}' },
  'data.eval.partiallyApplied': { ar: 'تم جزئيًا — تعذّر: {{p0}}', en: 'Partially applied — could not: {{p0}}' },
  'data.eval.noValuesToApply': { ar: 'لا توجد قيم للتطبيق', en: 'No values to apply' },
} as const satisfies Record<string, Message>
