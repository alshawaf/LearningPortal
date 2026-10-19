import collegeLogo from '../assets/hic-logo.svg';
import collegeLogoInverse from '../assets/hic-logo-inverse.svg';

export default function Brand({ compact = false }) {
  return (
    <div
      className={`brand ${compact ? 'brand--compact' : ''}`}
      aria-label="البوابة التعليمية"
    >
      <span className="brand__college-logo" aria-hidden="true">
        <img className="brand__logo brand__logo--default" src={collegeLogo} alt="" />
        <img className="brand__logo brand__logo--inverse" src={collegeLogoInverse} alt="" />
      </span>
      {!compact ? (
        <span className="brand__platform">
          <strong>البوابة التعليمية</strong>
        </span>
      ) : null}
    </div>
  );
}
