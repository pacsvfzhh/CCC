import { useState } from 'react';
import { CheckCircle, Upload, User, CreditCard, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getCurrentTimestamp } from '../../lib/dateUtils';
import { validateImageFile } from '../../lib/fileValidation';
import { useLanguage } from '../../lib/i18n';

interface VerificationFormProps {
  employeeId: string;
  onVerificationComplete: () => void;
  existingRequest?: {
    id: string;
    real_name: string;
    wallet_address: string;
    phone: string;
    email: string;
    id_front_url?: string | null;
    id_back_url?: string | null;
    selfie_url?: string | null;
  } | null;
}

export default function VerificationForm({ employeeId, onVerificationComplete, existingRequest }: VerificationFormProps) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    realName: existingRequest?.real_name || '',
    idNumber: existingRequest?.wallet_address || '',
    phone: existingRequest?.phone || '',
    address: existingRequest?.email || '',
  });
  const [files, setFiles] = useState<{
    idFront: File | null;
    idBack: File | null;
    selfie: File | null;
  }>({ idFront: null, idBack: null, selfie: null });
  const [uploadProgress, setUploadProgress] = useState<{
    message: string;
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const uploadFile = async (file: File, path: string, label: string): Promise<string> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${employeeId}-${Date.now()}.${fileExt}`;
      const filePath = `${path}/${fileName}`;

      const chunks = Math.ceil(file.size / (1024 * 100));
      for (let i = 0; i <= chunks; i++) {
        setUploadProgress({
          message: `${t.verification.uploadingFile} ${label}`,
          current: i,
          total: chunks,
          fileName: file.name
        });
        if (i < chunks) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('verification-documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error(`Failed to upload file: ${uploadError.message}`);
      }

      const { data: { publicUrl } } = supabase.storage
        .from('verification-documents')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error: any) {
      console.error('File upload error:', error);
      throw error;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'idFront' | 'idBack' | 'selfie') => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = await validateImageFile(file);

      if (!validation.valid) {
        setMessage({ type: 'error', text: validation.error || t.verification.fileValidationFailed });
        e.target.value = '';
        return;
      }

      setFiles({ ...files, [type]: file });
      setMessage(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      let idFrontUrl = existingRequest?.id_front_url || null;
      let idBackUrl = existingRequest?.id_back_url || null;
      let selfieUrl = existingRequest?.selfie_url || null;

      if (files.idFront) {
        idFrontUrl = await uploadFile(files.idFront, 'id-front', t.verification.doc1);
      }
      if (files.idBack) {
        idBackUrl = await uploadFile(files.idBack, 'id-back', t.verification.doc2);
      }
      if (files.selfie) {
        selfieUrl = await uploadFile(files.selfie, 'selfie', t.verification.doc3);
      }

      setUploadProgress({
        message: t.verification.submittingVerification,
        current: 100,
        total: 100,
        fileName: t.verification.finalizing
      });

      const { data: existingPending } = await supabase
        .from('verification_requests')
        .select('id')
        .eq('user_id', employeeId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingRequest || existingPending) {
        const targetId = existingRequest?.id || existingPending?.id;
        const { error } = await supabase
          .from('verification_requests')
          .update({
            real_name: formData.realName,
            wallet_address: formData.idNumber,
            phone: formData.phone,
            email: formData.address,
            id_front_url: idFrontUrl,
            id_back_url: idBackUrl,
            selfie_url: selfieUrl,
            status: 'pending',
            audit_remark: null,
            audited_by: null,
            audited_at: null,
            updated_at: getCurrentTimestamp(),
          })
          .eq('id', targetId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('verification_requests')
          .insert({
            user_id: employeeId,
            real_name: formData.realName,
            wallet_address: formData.idNumber,
            phone: formData.phone,
            email: formData.address,
            id_front_url: idFrontUrl,
            id_back_url: idBackUrl,
            selfie_url: selfieUrl,
            status: 'pending',
          });

        if (error) throw error;
      }

      setMessage({ type: 'success', text: t.verification.submitSuccess });

      setTimeout(() => {
        onVerificationComplete();
      }, 2000);
    } catch (error: any) {
      console.error('Error submitting verification:', error);
      const errorMessage = error?.message || t.verification.submitError;
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="bg-white rounded-lg sm:rounded-xl lg:rounded-2xl border border-blue-200 shadow-lg shadow-blue-100/50 p-3 sm:p-4 lg:p-6">
      <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4 lg:mb-6">
        <div className="w-10 h-10 sm:w-11 sm:h-11 bg-blue-50 rounded-md sm:rounded-lg flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-lg lg:text-xl font-bold text-gray-900 truncate">{existingRequest ? t.verification.resubmit : t.verification.title}</h2>
          <p className="text-gray-500 text-[10px] sm:text-xs lg:text-sm line-clamp-1">{existingRequest ? t.verification.resetDesc : t.verification.subtitle}</p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md sm:rounded-lg p-2.5 sm:p-3 lg:p-4 mb-3 sm:mb-4 lg:mb-6">
        <div className="flex gap-2 sm:gap-3">
          <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-blue-800 flex-1 min-w-0">
            <p className="font-medium mb-1">{t.verification.whyVerify}</p>
            <ul className="space-y-0.5 sm:space-y-1 text-[10px] sm:text-xs lg:text-sm text-blue-700">
              <li>• {t.verification.enableWithdrawals}</li>
              <li>• {t.verification.increaseSecurity}</li>
              <li>• {t.verification.complyRegulations}</li>
              <li>• {t.verification.protectEarnings}</li>
            </ul>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
            <span className="flex items-center gap-1.5 sm:gap-2">
              <User className="w-3 h-3 sm:w-4 sm:h-4" />
              {t.verification.fullName}
            </span>
          </label>
          <input
            type="text"
            value={formData.realName}
            onChange={(e) => setFormData({ ...formData, realName: e.target.value })}
            required
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 lg:py-3 bg-gray-50 border border-gray-300 rounded-md sm:rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-xs sm:text-sm lg:text-base"
            placeholder={t.verification.fullNamePlaceholder}
          />
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
            <span className="flex items-center gap-1.5 sm:gap-2">
              <CreditCard className="w-3 h-3 sm:w-4 sm:h-4" />
              {t.verification.walletAddress}
            </span>
          </label>
          <input
            type="text"
            value={formData.idNumber}
            onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
            required
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 lg:py-3 bg-gray-50 border border-gray-300 rounded-md sm:rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-xs sm:text-sm lg:text-base font-mono"
            placeholder={t.verification.walletAddressPlaceholder}
          />
          <p className="text-gray-500 text-[10px] sm:text-xs mt-1">{t.verification.walletAddressHint}</p>
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
            {t.verification.phoneNumber}
          </label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            required
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 lg:py-3 bg-gray-50 border border-gray-300 rounded-md sm:rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-xs sm:text-sm lg:text-base"
            placeholder={t.verification.phonePlaceholder}
          />
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
            {t.verification.email}
          </label>
          <input
            type="email"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            required
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 lg:py-3 bg-gray-50 border border-gray-300 rounded-md sm:rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-xs sm:text-sm lg:text-base"
            placeholder={t.verification.emailPlaceholder}
          />
        </div>

        <div className="bg-gray-50 rounded-md sm:rounded-lg p-2.5 sm:p-3 lg:p-4 border border-gray-200">
          <div className="flex items-start gap-2 sm:gap-3 mb-2.5 sm:mb-3">
            <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-medium text-gray-700 mb-0.5 sm:mb-1">
                {t.verification.documentsUpload} <span className="text-gray-400 text-[10px] sm:text-xs">{t.verification.optional}</span>
              </p>
              <p className="text-[10px] sm:text-xs text-gray-500">{t.verification.documentsUploadDesc}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="relative">
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,application/pdf"
                onChange={(e) => handleFileChange(e, 'idFront')}
                className="hidden"
                id="id-front-upload"
              />
              <label
                htmlFor="id-front-upload"
                className="flex flex-col items-center justify-center gap-1 sm:gap-2 w-full border border-dashed sm:border-2 border-gray-300 hover:border-blue-400 active:border-blue-500 rounded-md sm:rounded-lg p-2 sm:p-3 lg:p-4 cursor-pointer transition-all group min-h-[80px] sm:min-h-[100px]"
              >
                {files.idFront ? (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                    <span className="text-[9px] sm:text-xs text-green-600 text-center break-all line-clamp-2">{files.idFront.name}</span>
                  </>
                ) : existingRequest?.id_front_url ? (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                    <span className="text-[9px] sm:text-xs text-blue-600 text-center">{t.verification.previouslyUploaded}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[9px] sm:text-xs text-gray-400 group-hover:text-blue-500 transition-colors text-center">{t.verification.doc1}</span>
                  </>
                )}
              </label>
            </div>

            <div className="relative">
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,application/pdf"
                onChange={(e) => handleFileChange(e, 'idBack')}
                className="hidden"
                id="id-back-upload"
              />
              <label
                htmlFor="id-back-upload"
                className="flex flex-col items-center justify-center gap-1 sm:gap-2 w-full border border-dashed sm:border-2 border-gray-300 hover:border-blue-400 active:border-blue-500 rounded-md sm:rounded-lg p-2 sm:p-3 lg:p-4 cursor-pointer transition-all group min-h-[80px] sm:min-h-[100px]"
              >
                {files.idBack ? (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                    <span className="text-[9px] sm:text-xs text-green-600 text-center break-all line-clamp-2">{files.idBack.name}</span>
                  </>
                ) : existingRequest?.id_back_url ? (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                    <span className="text-[9px] sm:text-xs text-blue-600 text-center">{t.verification.previouslyUploaded}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[9px] sm:text-xs text-gray-400 group-hover:text-blue-500 transition-colors text-center">{t.verification.doc2}</span>
                  </>
                )}
              </label>
            </div>

            <div className="relative">
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                onChange={(e) => handleFileChange(e, 'selfie')}
                className="hidden"
                id="selfie-upload"
              />
              <label
                htmlFor="selfie-upload"
                className="flex flex-col items-center justify-center gap-1 sm:gap-2 w-full border border-dashed sm:border-2 border-gray-300 hover:border-blue-400 active:border-blue-500 rounded-md sm:rounded-lg p-2 sm:p-3 lg:p-4 cursor-pointer transition-all group min-h-[80px] sm:min-h-[100px]"
              >
                {files.selfie ? (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                    <span className="text-[9px] sm:text-xs text-green-600 text-center break-all line-clamp-2">{files.selfie.name}</span>
                  </>
                ) : existingRequest?.selfie_url ? (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                    <span className="text-[9px] sm:text-xs text-blue-600 text-center">{t.verification.previouslyUploaded}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                    <span className="text-[9px] sm:text-xs text-gray-400 group-hover:text-blue-500 transition-colors text-center">{t.verification.doc3}</span>
                  </>
                )}
              </label>
            </div>
          </div>

          <p className="text-[10px] sm:text-xs text-gray-500 mt-2 sm:mt-3 text-center">{t.verification.fileFormatHint}</p>
        </div>

        {uploadProgress && (
          <div className="rounded-lg p-4 bg-blue-50 border border-blue-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-600 animate-pulse" />
                <span className="text-sm font-medium text-blue-700">{uploadProgress.message}</span>
              </div>
              <span className="text-xs text-blue-600 font-bold">
                {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
              </span>
            </div>

            <div className="relative w-full h-2 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600 truncate max-w-[60%]">{uploadProgress.fileName}</span>
              <span className="text-gray-500">
                {uploadProgress.current} / {uploadProgress.total}
              </span>
            </div>
          </div>
        )}

        {message && (
          <div
            className={`rounded-md sm:rounded-lg p-2 sm:p-3 text-xs sm:text-sm ${
              message.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex gap-2 sm:gap-3 pt-1 sm:pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 min-h-[44px] bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:from-blue-700 active:to-blue-800 text-white py-2.5 sm:py-3 px-3 sm:px-4 rounded-md sm:rounded-lg font-medium shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm lg:text-base active:scale-95"
          >
            <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5" />
            {loading ? t.verification.submitting : existingRequest ? t.verification.resubmit : t.verification.submit}
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-md sm:rounded-lg p-2.5 sm:p-3 text-[10px] sm:text-xs lg:text-sm text-amber-800">
          <p className="font-medium mb-0.5 sm:mb-1">{t.verification.importantNotice}</p>
          <p className="text-amber-700 leading-relaxed">
            {t.verification.importantNoticeMsg}
          </p>
        </div>
      </form>
    </div>
  );
}
