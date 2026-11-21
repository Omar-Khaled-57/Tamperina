import type { Message } from '../i18n'

/** Undo/redo, evaluation helpers, find bar, toasts and Tampermonkey menu. */
export const actionsMessages = {
  // ---- Shared fallback labels ----------------------------------------------
  'core.student.fallback': { ar: 'الطالب', en: 'Student' },

  // ---- Undo/redo: errors (may be surfaced directly in toasts) --------------
  'core.undo.error.studentMissing': { ar: 'تعذّر تحديد الطالب لاستعادة الحضور', en: 'Could not identify the student to restore attendance' },
  'core.undo.error.lessonMissing': { ar: 'تعذّر تحديد الحصة لاستعادة الحضور', en: 'Could not identify the lesson to restore attendance' },
  'core.undo.error.noRestoredId': { ar: 'لم يُرجع الخادم معرّف سجل الحضور بعد الإعادة', en: 'The server did not return an attendance record ID after redo' },
  'core.undo.error.sendFailed': { ar: 'تعذّر إرسال الطلب', en: 'Could not send the request' },
  'core.undo.error.requestFailed': { ar: 'فشل الطلب ({{p0}})', en: 'Request failed ({{p0}})' },
  'core.undo.error.deleteNotConfirmed': { ar: 'لم يؤكد الخادم حذف سجل الحضور', en: 'The server did not confirm deletion of the attendance record' },
  'core.undo.error.gradeNotConfirmed': { ar: 'لم يؤكد الخادم حفظ التقييم', en: 'The server did not confirm saving the grade' },
  'core.undo.error.recordIdMissing': { ar: 'معرّف سجل الحضور غير موجود', en: 'Missing attendance record ID' },

  // ---- Undo/redo: history titles and details -------------------------------
  'core.undo.title.attendanceAdded': { ar: 'تسجيل حضور {{p0}}', en: 'Attendance recorded for {{p0}}' },
  'core.undo.title.attendanceRemoved': { ar: 'حذف حضور {{p0}}', en: 'Attendance removed for {{p0}}' },
  'core.undo.title.gradeChanged': { ar: 'تعديل تقييم {{p0}}', en: 'Grade changed for {{p0}}' },
  'core.undo.detail.studentCode': { ar: 'كود الطالب {{p0}}', en: 'Student code {{p0}}' },
  'core.undo.detail.attendance': { ar: 'عملية حضور', en: 'Attendance action' },
  'core.undo.detail.gradeChanged': { ar: 'من {{p0}} إلى {{p1}}{{p2}}', en: 'From {{p0}} to {{p1}}{{p2}}' },
  'core.undo.detail.batchCount': { ar: '{{p0}} عملية', en: '{{p0}} actions' },
  'core.undo.warning.batchPartial': { ar: 'اكتمل {{p0}} من {{p1}} — تعذّر: {{p2}}', en: 'Completed {{p0}} of {{p1}} — failed: {{p2}}' },

  // ---- Undo/redo: toasts ---------------------------------------------------
  'core.undo.toast.noUndo': { ar: 'لا يوجد ما يمكن التراجع عنه', en: 'Nothing to undo' },
  'core.undo.toast.noRedo': { ar: 'لا يوجد ما يمكن إعادته', en: 'Nothing to redo' },
  'core.undo.toast.undone': { ar: 'تم التراجع', en: 'Undone' },
  'core.undo.toast.redone': { ar: 'تمت الإعادة', en: 'Redone' },
  'core.undo.toast.undoneDesc': { ar: 'أُلغي: {{p0}}', en: 'Undid: {{p0}}' },
  'core.undo.toast.redoneDesc': { ar: 'أُعيد: {{p0}}', en: 'Redid: {{p0}}' },
  'core.undo.toast.partialUndo': { ar: 'تراجع جزئي', en: 'Partial undo' },
  'core.undo.toast.partialRedo': { ar: 'إعادة جزئية', en: 'Partial redo' },
  'core.undo.toast.undoFailed': { ar: 'تعذّر التراجع', en: 'Could not undo' },
  'core.undo.toast.redoFailed': { ar: 'تعذّرت الإعادة', en: 'Could not redo' },
  'core.undo.toast.enabled': { ar: 'التراجع مفعّل', en: 'Undo enabled' },
  'core.undo.toast.disabled': { ar: 'التراجع متوقف', en: 'Undo disabled' },
  'core.undo.toast.enabledDesc': { ar: 'Ctrl+Z للتراجع و Ctrl+Y للإعادة', en: 'Ctrl+Z to undo and Ctrl+Y to redo' },
  'core.undo.toast.disabledDesc': { ar: 'لن تُسجَّل عمليات جديدة', en: 'No new actions will be recorded' },

  // ---- Evaluation helpers -------------------------------------------------
  'core.eval.toast.studentSelected': { ar: 'تم تحديد الطالب', en: 'Student selected' },

  // ---- Find bar ------------------------------------------------------------
  'core.find.placeholder': { ar: 'ابحث في الطلاب...', en: 'Search students...' },
  'core.find.inputAria': { ar: 'البحث في التقييم', en: 'Search evaluation' },
  'core.find.prevAria': { ar: 'السابق', en: 'Previous' },
  'core.find.prevTitle': { ar: 'السابق (Shift+Enter)', en: 'Previous (Shift+Enter)' },
  'core.find.nextAria': { ar: 'التالي', en: 'Next' },
  'core.find.nextTitle': { ar: 'التالي (Enter)', en: 'Next (Enter)' },
  'core.find.matchCase': { ar: 'تطابق حالة الحروف', en: 'Match case' },
  'core.find.closeAria': { ar: 'إغلاق', en: 'Close' },
  'core.find.closeTitle': { ar: 'إغلاق (Esc)', en: 'Close (Esc)' },

  // ---- Toasts --------------------------------------------------------------
  'core.toast.close': { ar: 'إغلاق', en: 'Close' },

  // ---- Feature registry ----------------------------------------------------
  'core.feature.undoRedo.label': { ar: 'التراجع وإعادة التنفيذ', en: 'Undo / Redo' },
  'core.feature.undoRedo.description': { ar: 'Ctrl+Z / Ctrl+Y لعمليات الحضور والتقييم (يدعم الإلغاء الجماعي)', en: 'Ctrl+Z / Ctrl+Y for attendance and grading actions (supports bulk undo)' },
  'core.feature.bulk.label': { ar: 'الإجراءات الجماعية', en: 'Bulk actions' },
  'core.feature.bulk.description': { ar: 'حضور جماعي (أكواد/أسماء) مع تحليل وتسليح وتراجع دفعة واحدة، مع بنود جماعية أخرى', en: 'Bulk attendance (codes/names) with preview, arming and one-step undo, plus other bulk actions' },
} as const satisfies Record<string, Message>
