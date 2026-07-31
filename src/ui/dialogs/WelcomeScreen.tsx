import { useState } from 'react'
import './WelcomeScreen.css'

type WelcomeScreenProps = {
  error: string | null
  onCreate: (name: string) => void
  onOpen: () => void
}

export function WelcomeScreen({ error, onCreate, onOpen }: WelcomeScreenProps) {
  const [name, setName] = useState('')

  return (
    <div className="welcome">
      <div className="welcome__card">
        <p className="welcome__brand">Bloodlines</p>
        <h1 className="welcome__title">Start a pedigree</h1>
        <p className="welcome__body">
          Create a new project or open a JSON backup from your computer.
        </p>

        <form
          className="welcome__form"
          onSubmit={(event) => {
            event.preventDefault()
            onCreate(name.trim() || 'Untitled')
          }}
        >
          <label className="welcome__field">
            <span>Project name</span>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="e.g. Ice flight line"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="welcome__primary">
            Create project
          </button>
        </form>

        <div className="welcome__divider">
          <span>or</span>
        </div>

        <button type="button" className="welcome__secondary" onClick={onOpen}>
          Open JSON...
        </button>

        {error ? <p className="welcome__error">{error}</p> : null}
      </div>
    </div>
  )
}
